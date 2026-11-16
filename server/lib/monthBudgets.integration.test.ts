// A month's budget lines (Partidas, LPBETA-27) against a REAL Postgres: a
// saved month still lists every debt line at that month's cuota, an ended
// month keeps the debt-line budget it saved, and the Generosity line stays
// first under concurrent reorders. Opt-in: skipped unless TEST_DATABASE_URL
// is set; every table is TRUNCATEd, so localhost only.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55437/budget_test npm run test:integration
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("month budgets (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let periodLib: typeof import("./period.js");
  let generosityLib: typeof import("./generosity.js");
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
    process.env.EMAIL_FROM = "Remanso <test@example.com>";
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;

    ({ prisma } = await import("./prisma.js"));
    ({ signToken } = await import("./jwt.js"));
    ({ createDefaultAllocations } = await import("./defaults.js"));
    periodLib = await import("./period.js");
    generosityLib = await import("./generosity.js");
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

  const current = () => periodLib.currentPeriodKey(1);
  const previous = () => periodLib.periodKeyOffset(current(), -1);
  const cents = (euros: number) => Math.round(euros * 100);
  const sumCents = (rows: any[], k: string) => rows.reduce((s, r) => s + cents(r[k]), 0);

  /** A loan of 150 a month and its debt line. */
  async function loan(userId: string, extra: Record<string, unknown> = {}) {
    const debt = (await ok(userId, "POST", "/api/debts", {
      name: "Préstamo coche", kind: "installment", paymentMode: "installments",
      installmentAmount: 150, installmentsTotal: 12, installmentsPaid: 0, ...extra,
    })).debt.id as string;
    const line = (await prisma.allocation.findFirstOrThrow({ where: { userId, debtId: debt } })).id;
    return { debt, line };
  }

  /** Saves one non-debt line's budget for `month`, as Partidas does. */
  async function saveOther(userId: string, month: string, euros: number) {
    const other = await prisma.allocation.findFirstOrThrow({ where: { userId, type: { notIn: ["debt", "generosity"] } }, orderBy: { sortOrder: "asc" } });
    return ok(userId, "POST", "/api/monthly-budgets/save", { month, budgets: [{ allocationId: other.id, allocatedAmount: euros }] });
  }

  it("a saved month lists every debt line at that month's cuota, and every screen agrees", async () => {
    const A = await signUp("Ana");
    await ok(A.id, "GET", "/api/allocations"); // creates the Generosity line
    const { line } = await loan(A.id);
    const month = previous();

    const saved = await saveOther(A.id, month, 321);
    assert.equal(saved.budgets.find((b: any) => b.allocationId === line)?.allocatedAmount, 150, "the save's answer keeps the debt line");
    assert.equal(await prisma.monthlyBudget.count({ where: { allocationId: line } }), 0);

    const got = await ok(A.id, "GET", `/api/monthly-budgets?month=${month}`);
    const row = got.budgets.find((b: any) => b.allocationId === line);
    assert.ok(row, "the debt line is listed for a saved month");
    assert.equal(row.allocatedAmount, 150);
    assert.equal(row.saved, false);
    assert.ok(got.budgets.some((b: any) => b.allocation.type === "generosity"), "the Generosity line too");

    const review = await ok(A.id, "GET", `/api/monthly-budgets/review?month=${month}`);
    assert.equal(review.review.find((r: any) => r.allocationId === line).budgeted, 150);
    const stats = await ok(A.id, "GET", `/api/analytics?from=${month}&to=${month}`);
    // Partidas, the review and analytics: the same month total.
    assert.equal(sumCents(got.budgets, "allocatedAmount"), cents(review.totalBudgeted));
    assert.equal(cents(stats.alignment.budgeted), cents(review.totalBudgeted));
  });

  it("a partner's private debt line stays hidden in a saved month, counted only in hiddenCommitted", async () => {
    const A = await signUp("Rosa");
    const B = await signUp("Luz");
    await ok(A.id, "POST", "/api/partner/invite", { email: B.email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: A.id, status: "pending" } });
    await ok(B.id, "POST", "/api/partner/accept", { token: inv.token });
    const household = (await ok(A.id, "GET", "/api/households/current")).household;
    await ok(A.id, "PATCH", `/api/households/${household.id}`, { visibilityTier: "transparent" });

    const { line } = await loan(A.id, { visibility: "private" });
    const month = previous();
    await saveOther(A.id, month, 200);

    const bMonth = await ok(B.id, "GET", `/api/monthly-budgets?month=${month}`);
    assert.ok(!JSON.stringify(bMonth).includes(line), "never listed to B");
    assert.equal(bMonth.hiddenCommitted, 150);
    const aMonth = await ok(A.id, "GET", `/api/monthly-budgets?month=${month}`);
    assert.equal(aMonth.budgets.find((b: any) => b.allocationId === line)?.allocatedAmount, 150);
    assert.equal(sumCents(bMonth.budgets, "allocatedAmount") + cents(bMonth.hiddenCommitted), sumCents(aMonth.budgets, "allocatedAmount"));
  });

  it("an ended month keeps the debt-line budget it saved after the debt is archived; the current one follows the debt", async () => {
    const A = await signUp("Eva");
    await ok(A.id, "GET", "/api/allocations");
    const { debt, line } = await loan(A.id);
    const past = previous();
    const now = current();
    await saveOther(A.id, past, 100);
    await saveOther(A.id, now, 100);
    // Rows saved for the debt line (from before its amount became read-only).
    await prisma.monthlyBudget.createMany({ data: [
      { userId: A.id, allocationId: line, month: past, allocatedAmount: 12000 },
      { userId: A.id, allocationId: line, month: now, allocatedAmount: 12000 },
    ] });
    await ok(A.id, "PATCH", `/api/debts/${debt}`, { status: "archived" });

    const pastMonth = await ok(A.id, "GET", `/api/monthly-budgets?month=${past}`);
    assert.equal(pastMonth.budgets.find((b: any) => b.allocationId === line).allocatedAmount, 120);
    const pastReview = await ok(A.id, "GET", `/api/monthly-budgets/review?month=${past}`);
    assert.equal(pastReview.review.find((r: any) => r.allocationId === line).budgeted, 120);
    const pastStats = await ok(A.id, "GET", `/api/analytics?from=${past}&to=${past}`);
    assert.equal(cents(pastStats.alignment.budgeted), cents(pastReview.totalBudgeted));
    assert.equal(sumCents(pastMonth.budgets, "allocatedAmount"), cents(pastReview.totalBudgeted));

    // The current period is still the debt's: archived, it commits 0.
    const nowMonth = await ok(A.id, "GET", `/api/monthly-budgets?month=${now}`);
    assert.equal(nowMonth.budgets.find((b: any) => b.allocationId === line).allocatedAmount, 0);
    const nowReview = await ok(A.id, "GET", `/api/monthly-budgets/review?month=${now}`);
    assert.equal(nowReview.review.find((r: any) => r.allocationId === line).budgeted, 0);
  });

  it("the Generosity line stays first under concurrent reorders and reads, and no read fails", async () => {
    const A = await signUp("Sol");
    const first = await ok(A.id, "GET", "/api/allocations");
    const ids = (first.allocations as any[]).map(a => a.id as string);
    const gen = (first.allocations as any[]).find(a => a.type === "generosity").id as string;
    assert.equal(ids[0], gen);

    // Each reorder puts Generosity last, in a different order of the rest.
    const rest = ids.filter(id => id !== gen);
    const reorder = (k: number) => {
      const rotated = [...rest.slice(k % rest.length), ...rest.slice(0, k % rest.length), gen];
      return call(A.id, "PATCH", "/api/allocations/reorder", { order: rotated.map((id, i) => ({ id, sortOrder: i })) });
    };
    const results = await Promise.all(Array.from({ length: 12 }, (_, k) =>
      k % 2 === 0 ? reorder(k) : call(A.id, "GET", "/api/allocations")));
    for (const r of results) assert.equal(r.status, 200, JSON.stringify(r.body));

    const lines = await prisma.allocation.findMany({ where: { userId: A.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    assert.equal(lines[0].id, gen, "Generosity first");
    assert.ok(lines.slice(1).every(l => l.sortOrder > lines[0].sortOrder), "strictly first");
    assert.equal(new Set(lines.map(l => l.sortOrder)).size, lines.length, "no two lines share a place");
  });

  it("the Generosity repair reads the order only after a reorder in flight commits", async () => {
    const A = await signUp("Mar");
    const gen = ((await ok(A.id, "GET", "/api/allocations")).allocations as any[]).find(a => a.type === "generosity").id as string;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let locked!: () => void;
    const holding = new Promise<void>(resolve => { locked = resolve; });
    // A reorder in flight: holds the order lock and moves Generosity last.
    const reorder = prisma.$transaction(async (tx) => {
      await generosityLib.lockLineOrder(tx, A.id);
      await tx.allocation.update({ where: { id: gen }, data: { sortOrder: 1000 } });
      locked();
      await gate;
    });
    await holding;
    let repaired = false;
    const repair = generosityLib.keepGenerosityFirst(A.id).then(() => { repaired = true; });
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(repaired, false, "the repair waits for the reorder");
    release();
    await Promise.all([reorder, repair]);
    const lines = await prisma.allocation.findMany({ where: { userId: A.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    assert.equal(lines[0].id, gen, "repaired over the committed reorder, not a stale read");
  });
});
