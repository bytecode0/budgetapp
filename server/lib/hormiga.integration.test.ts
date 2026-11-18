// Gastos hormiga, subscriptions and the monthly email (LPBETA-12) against a
// REAL Postgres, through the API: what counts as a subscription (and what
// doesn't: rent, a loan), small frequent expenses, price rises, "la quiero" /
// "voy a cancelarla", household visibility (a partner never sees the other's
// merchants), the monthly email setting, the unsubscribe link without a
// session, the monthly job (who gets it, only once, no merchant names) and
// the account export. Opt-in: skipped unless TEST_DATABASE_URL is set.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55450/budget_test npm run test:integration
//
// Every table is TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("gastos hormiga and the monthly email (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let unsubscribeToken: typeof import("./unsubscribe.js").unsubscribeToken;
  let runMonthlyEmail: typeof import("./monthlyEmail.js").runMonthlyEmail;
  let buildJsonExport: typeof import("./accountExport.js").buildJsonExport;
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.EMAIL_PROVIDER = "console";
    process.env.EMAIL_FROM = "Remanso <test@example.com>";

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ unsubscribeToken } = await import("./unsubscribe.js"));
    ({ runMonthlyEmail } = await import("./monthlyEmail.js"));
    ({ buildJsonExport } = await import("./accountExport.js"));
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    await prisma?.$disconnect();
  });

  async function call(userId: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...headers,
        ...(userId && { cookie: `token=${signToken({ userId })}` }),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() as any };
  }

  // Calendar-month periods (payday 1), relative to today.
  const now = new Date();
  const utc = (monthsAgo: number, day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, day));
  const key = (monthsAgo: number) => utc(monthsAgo, 1).toISOString().slice(0, 7);
  const LAST_MONTH = key(1);

  async function person(tag: string, extra: { linkedUserId?: string } = {}) {
    const user = await prisma.user.create({ data: { email: `${tag}@test.local`, name: `${tag} Test`, emailVerified: new Date() } });
    await prisma.userSettings.create({ data: { userId: user.id, ...extra } });
    return user;
  }

  // A household's history: Netflix (monthly), Spotify (price rise), Amazon
  // Prime (yearly), rent and a loan (recurring, not subscriptions), and a café
  // 18 times last month at 3.20.
  async function history(pool: string, payer: string) {
    const line = (name: string, type = "fixed", debtId?: string) =>
      prisma.allocation.create({ data: { userId: pool, name, type, debtId } });
    const subs = await line("Suscripciones");
    const rent = await line("Alquiler o hipoteca");
    const debt = await prisma.debt.create({ data: { userId: pool, ownerUserId: payer, name: "Préstamo coche", kind: "auto_loan" } });
    const loanLine = await line("Préstamo coche", "debt", debt.id);
    const cafes = await line("Cafés", "flexible");
    const add = (merchant: string, amount: number, date: Date, allocationId: string | null, debtId: string | null = null) =>
      prisma.expense.create({ data: { userId: pool, merchant, description: merchant, amount, date, allocationId, debtId, payerUserId: payer, createdByUserId: payer } });
    for (const m of [3, 2, 1]) {
      await add("netflix", 1299, utc(m, 5), subs.id);
      await add("inmobiliaria sol", 90000, utc(m, 1), rent.id);
      await add("cofidis", 25000, utc(m, 10), loanLine.id, debt.id);
    }
    for (const [m, amount] of [[4, 999], [3, 999], [2, 999], [1, 1099]]) await add("spotify", amount, utc(m, 12), subs.id);
    await add("amazon prime", 4990, utc(13, 8), subs.id);
    await add("amazon prime", 4990, utc(1, 8), subs.id);
    for (let d = 1; d <= 18; d++) await add("cafe lopez", 320, utc(1, d), cafes.id);
    return { subs, rent, cafes };
  }

  it("needs a session (except the unsubscribe link), and a valid month", async () => {
    assert.equal((await call(null, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`)).status, 401);
    assert.equal((await call(null, "GET", "/api/insights/monthly-email")).status, 401);
    assert.equal((await call(null, "PATCH", "/api/insights/monthly-email", { enabled: false })).status, 401);
    const solo = await person("needs-month");
    assert.equal((await call(solo.id, "GET", "/api/insights/hormiga?month=2026-13")).status, 400);
    assert.equal((await call(solo.id, "GET", "/api/insights/hormiga")).status, 400);
  });

  it("subscriptions (any amount) and small frequent expenses, carried to the year; rent and a loan are not subscriptions", async () => {
    const ana = await person("ana");
    await history(ana.id, ana.id);
    const r = await call(ana.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`);
    assert.equal(r.status, 200);
    const d = r.json.data;
    const merchants = d.subscriptions.map((s: any) => s.merchant).sort();
    assert.deepEqual(merchants, ["amazon prime", "netflix", "spotify"]);

    const netflix = d.subscriptions.find((s: any) => s.merchant === "netflix");
    assert.equal(netflix.cadence, "monthly");
    assert.equal(netflix.amount, 12.99);
    assert.equal(netflix.yearlyAmount, 155.88);
    const spotify = d.subscriptions.find((s: any) => s.merchant === "spotify");
    assert.equal(spotify.previousAmount, 9.99, "price rise from 9.99");
    assert.equal(spotify.amount, 10.99);
    const prime = d.subscriptions.find((s: any) => s.merchant === "amazon prime");
    assert.equal(prime.cadence, "yearly");
    assert.equal(prime.yearlyAmount, 49.9);
    assert.ok(d.subscriptions.every((s: any) => typeof s.id === "string" && s.decision === null));

    assert.equal(d.small.length, 1);
    assert.deepEqual(
      { kind: d.small[0].kind, label: d.small[0].label, count: d.small[0].count, amount: d.small[0].amount, total: d.small[0].total, yearlyTotal: d.small[0].yearlyTotal },
      { kind: "merchant", label: "cafe lopez", count: 18, amount: 3.2, total: 57.6, yearlyTotal: 691.2 },
    );
    // 155.88 + 131.88 + 49.90 a year in subscriptions, 691.20 in cafés.
    assert.equal(d.totals.subscriptionsYearly, 337.66);
    assert.equal(d.totals.yearlyTotal, 1028.86);
    assert.equal(d.totals.halfYearly, 514.43);
  });

  it("'la quiero' / 'voy a cancelarla' is saved on the commitment, can be taken back, and is validated", async () => {
    const bea = await person("bea");
    await history(bea.id, bea.id);
    const subs = (await call(bea.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`)).json.data.subscriptions;
    const netflix = subs.find((s: any) => s.merchant === "netflix");
    assert.equal((await call(bea.id, "PATCH", `/api/recurring/${netflix.id}`, { decision: "maybe" })).status, 400);
    assert.equal((await call(bea.id, "PATCH", `/api/recurring/${netflix.id}`, { decision: "cancel" })).status, 200);
    let again = (await call(bea.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`)).json.data.subscriptions;
    assert.equal(again.find((s: any) => s.merchant === "netflix").decision, "cancel");
    assert.equal(again.find((s: any) => s.merchant === "netflix").chargedAfterCancel, false);

    // Charged again after saying "voy a cancelarla".
    await prisma.recurringCommitment.update({ where: { id: netflix.id }, data: { decidedAt: utc(2, 20) } });
    again = (await call(bea.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`)).json.data.subscriptions;
    assert.equal(again.find((s: any) => s.merchant === "netflix").chargedAfterCancel, true);

    assert.equal((await call(bea.id, "PATCH", `/api/recurring/${netflix.id}`, { decision: null })).status, 200);
    const row = await prisma.recurringCommitment.findUniqueOrThrow({ where: { id: netflix.id } });
    assert.equal(row.decision, null);
    assert.equal(row.decidedAt, null);

    // Somebody else can't answer it.
    const stranger = await person("stranger");
    assert.equal((await call(stranger.id, "PATCH", `/api/recurring/${netflix.id}`, { decision: "keep" })).status, 404);
  });

  it("a commitment the household ignored is not a subscription", async () => {
    const cris = await person("cris");
    await history(cris.id, cris.id);
    await prisma.recurringCommitment.create({ data: { userId: cris.id, merchant: "netflix", avgAmount: 1299, status: "ignored" } });
    const subs = (await call(cris.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`)).json.data.subscriptions;
    assert.ok(!subs.some((s: any) => s.merchant === "netflix"));
  });

  it("household: a partner who may only list her own movements never sees the other's merchants", async () => {
    const owner = await person("dani-owner");
    const partner = await person("dani-partner", { linkedUserId: owner.id });
    await history(owner.id, owner.id);
    const r = await call(partner.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`);
    assert.equal(r.status, 200);
    const body = JSON.stringify(r.json);
    for (const merchant of ["netflix", "spotify", "amazon prime", "cafe lopez"]) assert.ok(!body.includes(merchant), merchant);
    assert.equal(r.json.data.totals.yearlyTotal, 0);
  });

  it("the monthly email setting is the person's own, and the unsubscribe link works without a session", async () => {
    const eva = await person("eva");
    assert.deepEqual((await call(eva.id, "GET", "/api/insights/monthly-email")).json, { data: { enabled: true } });
    assert.equal((await call(eva.id, "PATCH", "/api/insights/monthly-email", { enabled: "no" })).status, 400);
    assert.deepEqual((await call(eva.id, "PATCH", "/api/insights/monthly-email", { enabled: false })).json, { data: { enabled: false } });
    assert.deepEqual((await call(eva.id, "PATCH", "/api/insights/monthly-email", { enabled: true })).json, { data: { enabled: true } });

    assert.equal((await call(null, "POST", "/api/insights/unsubscribe", { token: "nope" })).status, 400);
    assert.equal((await call(null, "POST", "/api/insights/unsubscribe", {})).status, 400);
    const ok = await call(null, "POST", "/api/insights/unsubscribe", { token: unsubscribeToken(eva.id) });
    assert.deepEqual(ok.json, { data: { unsubscribed: true } });
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: eva.id } })).monthlyEmailOptOut, true);
    // The token is not a session.
    const asSession = await fetch(`${base}/api/insights/monthly-email`, { headers: { cookie: `token=${unsubscribeToken(eva.id)}` } });
    assert.equal(asSession.status, 401);
  });

  it("the monthly job: only with CRON_SECRET; sends the last month once, totals only, never to who opted out or has nothing", async () => {
    assert.equal((await call(null, "GET", "/api/insights/cron")).status, 401);
    assert.equal((await call(null, "GET", "/api/insights/cron", undefined, { authorization: "Bearer wrong" })).status, 401);

    await prisma.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
    const fran = await person("fran");
    await history(fran.id, fran.id);
    const quiet = await person("quiet");            // nothing to say
    const out = await person("out");                // opted out
    await history(out.id, out.id);
    await prisma.userSettings.update({ where: { userId: out.id }, data: { monthlyEmailOptOut: true } });
    const leaving = await person("leaving");        // account being deleted
    await prisma.user.update({ where: { id: leaving.id }, data: { deletionRequestedAt: new Date() } });

    const sent: { to: string; data: any; locale: string }[] = [];
    const send = async (to: string, data: any, locale: string) => { sent.push({ to, data, locale }); };
    const first = await runMonthlyEmail(prisma, { now, send });
    assert.deepEqual(first, { sent: 1, skipped: 1, failed: 0, remaining: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, fran.email);
    assert.equal(sent[0].data.period, LAST_MONTH);
    assert.equal(sent[0].data.subscriptionsCount, 3);
    assert.equal(sent[0].data.smallCount, 1);
    assert.equal(sent[0].data.smallTotal, 5760);
    assert.equal(sent[0].data.priceRises, 1);
    assert.ok(!JSON.stringify(sent[0].data).includes("netflix") && !JSON.stringify(sent[0].data).includes("cafe"), "no merchant names");
    const link = new URL(sent[0].data.unsubscribeUrl);
    assert.equal(link.pathname, "/unsubscribe");
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: fran.id } })).monthlyEmailSentPeriod, LAST_MONTH);
    assert.ok(!sent.some(s => [quiet.email, out.email, leaving.email].includes(s.to)));

    // Again: nobody gets it twice.
    const second = await runMonthlyEmail(prisma, { now, send });
    assert.equal(second.sent, 0);
    assert.equal(sent.length, 1);

    // Through the route (console transport), with the secret.
    await prisma.userSettings.update({ where: { userId: fran.id }, data: { monthlyEmailSentPeriod: null } });
    const viaRoute = await call(null, "GET", "/api/insights/cron", undefined, { authorization: "Bearer cron-test-secret" });
    assert.equal(viaRoute.status, 200);
    assert.equal(viaRoute.json.data.sent, 1);
  });

  it("the account export has the monthly email setting and the answers to subscriptions", async () => {
    const gil = await person("gil");
    await history(gil.id, gil.id);
    const netflix = (await call(gil.id, "GET", `/api/insights/hormiga?month=${LAST_MONTH}`)).json.data.subscriptions.find((s: any) => s.merchant === "netflix");
    await call(gil.id, "PATCH", `/api/recurring/${netflix.id}`, { decision: "keep" });
    await call(gil.id, "PATCH", "/api/insights/monthly-email", { enabled: false });
    const doc = await buildJsonExport(prisma, gil.id) as any;
    assert.equal(doc.settings.monthlyEmailOptOut, true);
    assert.ok("monthlyEmailSentPeriod" in doc.settings);
    assert.equal(doc.recurringCommitments.find((r: any) => r.merchant === "netflix").decision, "keep");
  });
});
