// The card billing cycle (LPBETA-01) against a REAL Postgres: GET /api/debts
// splits a card's balance into "lo que vence" and what's after the cut-off,
// GET /api/debts/timeline commits each statement to the period it's due in, a
// card without statementDay keeps today's behaviour, and a member's private
// card stays out of the partner's view. Opt-in like
// partnerFlow.integration.test.ts: skipped unless TEST_DATABASE_URL is set;
// every table is TRUNCATEd, so localhost only.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/budget_test npm run test:integration
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// The scenario is built around today: the statement closed yesterday and is
// due today. That needs yesterday in this month and both days in 1-28 (the
// stored range), i.e. today between the 2nd and the 28th.
const NOW = new Date();
const TODAY = NOW.getUTCDate();
const scenarioFits = TODAY >= 2 && TODAY <= 28;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utcDay = (offsetDays: number) =>
  new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + offsetDays));
/** Day `day` of the month `offset` months from now, clamped. */
const dayOfMonth = (offset: number, day: number) => {
  const first = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, last)));
};

describe("card billing cycle (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let periodLib: typeof import("./period.js");
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.JWT_SECRET = "integration-test-secret";
    process.env.NODE_ENV = "test";
    process.env.EMAIL_PROVIDER = "console";
    process.env.EMAIL_FROM = "LifePlan <test@example.com>";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ createDefaultAllocations } = await import("./defaults.js"));
    periodLib = await import("./period.js");
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.length > 0, "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
    await prisma?.$disconnect();
  });

  // ── helpers ────────────────────────────────────────────────────────────

  async function call(userId: string, method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        cookie: `token=${signToken({ userId })}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() as any };
  }

  async function ok(userId: string, method: string, path: string, body?: unknown) {
    const r = await call(userId, method, path, body);
    assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }

  let seq = 0;
  async function signUp(name: string) {
    const email = `${name.toLowerCase()}${++seq}@test.local`;
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    return { id: user.id, email };
  }

  /** A (owner) and B (member) in one transparent household. */
  async function couple() {
    const A = await signUp("Ana");
    const B = await signUp("Bea");
    await ok(A.id, "POST", "/api/partner/invite", { email: B.email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: A.id, status: "pending" } });
    await ok(B.id, "POST", "/api/partner/accept", { token: inv.token });
    return { A: A.id, B: B.id };
  }

  /** A card account (its debt follows, server/lib/cardDebt.ts), with its debt
   *  anchored 10 days ago so purchases dated since then are in its ledger. */
  async function card(userId: string, name: string, owed: number, over: { visibility?: string; statementDay?: number | null; paymentDueDay?: number | null } = {}) {
    const { account } = await ok(userId, "POST", "/api/accounts", {
      name, type: "card", currentBalance: owed, cardPaymentMode: "full",
      ...(over.visibility && { visibility: over.visibility }),
    });
    const pool = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).userId;
    const debt = await prisma.debt.findFirstOrThrow({ where: { userId: pool, accountId: account.id } });
    await prisma.debt.update({ where: { id: debt.id }, data: { balanceAsOf: utcDay(-10) } });
    if (over.statementDay !== undefined || over.paymentDueDay !== undefined) {
      await ok(userId, "PATCH", `/api/debts/${debt.id}`, {
        ...(over.statementDay !== undefined && { statementDay: over.statementDay }),
        ...(over.paymentDueDay !== undefined && { paymentDueDay: over.paymentDueDay }),
      });
    }
    return { accountId: account.id as string, debtId: debt.id };
  }

  const purchase = (userId: string, accountId: string, amount: number, date: Date) =>
    ok(userId, "POST", "/api/expenses", { amount, description: "Compra", accountId, date: iso(date) });

  async function pay(userId: string, debtId: string, amount: number, date: Date) {
    const pool = (await prisma.debt.findUniqueOrThrow({ where: { id: debtId } })).userId;
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: pool, debtId } });
    const bank = await prisma.account.findFirstOrThrow({ where: { userId: pool, ownerUserId: userId, type: { not: "card" } } });
    return ok(userId, "POST", "/api/expenses", { amount, description: "Pago tarjeta", allocationId: line.id, accountId: bank.id, date: iso(date) });
  }

  const debtsOf = async (userId: string) => (await ok(userId, "GET", "/api/debts")).debts as any[];
  const timelineOf = async (userId: string) => (await ok(userId, "GET", "/api/debts/timeline?periods=3")).timeline as any[];
  const itemAmounts = (timeline: any[], debtId: string) =>
    timeline.map(p => (p.items as any[]).find(i => i.debtId === debtId)?.amount ?? 0);

  // ── the cycle ──────────────────────────────────────────────────────────

  it("splits what's due from purchases after the cut-off, and commits each to its period", { skip: !scenarioFits && "today must be between the 2nd and the 28th" }, async () => {
    const { A } = await couple();
    // Cut-off yesterday, due today: yesterday's purchase is in the closed
    // statement, today's is after the cut-off (due next month).
    const visa = await card(A, "Visa", 100, { statementDay: TODAY - 1, paymentDueDay: TODAY });
    await purchase(A, visa.accountId, 50, utcDay(-1));
    await purchase(A, visa.accountId, 20, utcDay(0));
    await pay(A, visa.debtId, 30, utcDay(0));

    const d = (await debtsOf(A)).find(x => x.id === visa.debtId);
    assert.equal(d.owed, 140);
    assert.deepEqual(d.cycle, {
      dueOn: iso(utcDay(0)),
      closesOn: iso(utcDay(-1)),
      closed: true,
      dueAmount: 120,       // anchor 100 + 50 up to the cut-off − 30 paid
      afterCutAmount: 20,   // today's purchase
      afterCutDueOn: iso(dayOfMonth(1, TODAY)),
    });

    // Calendar periods (cycleStartDay 1): this month commits the statement due
    // today (150 — paying during the period doesn't shrink it); next month the
    // purchase after the cut-off; then nothing recorded yet.
    const tl = await timelineOf(A);
    assert.equal(tl[0].period, periodLib.currentPeriodKey(1));
    assert.deepEqual(itemAmounts(tl, visa.debtId), [150, 20, 0]);
  });

  it("a card without a statement day keeps today's behaviour", async () => {
    const { A } = await couple();
    const plain = await card(A, "Amex", 80, { paymentDueDay: 5 });
    await purchase(A, plain.accountId, 15, utcDay(0));

    const d = (await debtsOf(A)).find(x => x.id === plain.debtId);
    assert.equal(d.statementDay, null);
    assert.equal(d.cycle, null);
    assert.equal(d.owed, 95);
    // Paid in full without a cycle: only the pre-existing debt, this period.
    assert.deepEqual(itemAmounts(await timelineOf(A), plain.debtId), [80, 0, 0]);
  });

  it("a member's private card stays out of the partner's debts and timeline; a shared one is in", { skip: !scenarioFits && "today must be between the 2nd and the 28th" }, async () => {
    const { A, B } = await couple();
    const secret = await card(B, "Privada", 60, { visibility: "private", statementDay: TODAY - 1, paymentDueDay: TODAY });
    const shared = await card(B, "Común", 40, { statementDay: TODAY - 1, paymentDueDay: TODAY });
    await purchase(B, secret.accountId, 25, utcDay(0));

    // The owner sees both, with their cycle.
    const mine = await debtsOf(B);
    assert.equal(mine.find(x => x.id === secret.debtId)?.cycle?.dueAmount, 60);
    assert.equal(mine.find(x => x.id === secret.debtId)?.cycle?.afterCutAmount, 25);
    assert.deepEqual(itemAmounts(await timelineOf(B), secret.debtId), [60, 25, 0]);

    // The partner: the shared card with its cycle, no trace of the private one.
    const theirs = await debtsOf(A);
    assert.equal(theirs.some(x => x.id === secret.debtId), false);
    assert.equal(theirs.find(x => x.id === shared.debtId)?.cycle?.dueAmount, 40);
    const tl = await timelineOf(A);
    assert.equal(tl.some(p => (p.items as any[]).some(i => i.debtId === secret.debtId || i.name === "Privada")), false);
    assert.deepEqual(itemAmounts(tl, shared.debtId), [40, 0, 0]);
  });

  it("statementDay is accepted on PATCH, clamped to 1-28 and clearable", async () => {
    const { A } = await couple();
    const c = await card(A, "Clamp", 0, { statementDay: 31 });
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: c.debtId } })).statementDay, 28);
    await ok(A, "PATCH", `/api/debts/${c.debtId}`, { statementDay: null });
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: c.debtId } })).statementDay, null);
  });
});
