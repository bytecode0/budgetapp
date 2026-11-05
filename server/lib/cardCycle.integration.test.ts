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

const iso = (d: Date) => d.toISOString().slice(0, 10);
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
// The routes read the date from server/lib/clock.ts, pinned per test: the
// scenarios don't depend on the day the suite runs.
const NOV_2 = new Date("2026-11-02T12:00:00Z");
const NOV_20 = new Date("2026-11-20T12:00:00Z");

describe("card billing cycle (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let setClockForTests: typeof import("./clock.js").setClockForTests;
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
    ({ setClockForTests } = await import("./clock.js"));
    const app = (await import("../app.js")).default;

    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    assert.ok(tables.length > 0, "schema not pushed to the test database");
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map(t => `"${t.tablename}"`).join(", ")} CASCADE`);

    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    setClockForTests?.(null);
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

  /** A card account (its debt follows, server/lib/cardDebt.ts), its debt
   *  anchored at `asOf` (what it owed then) so later purchases are in its
   *  ledger. Cut-off on the 25th, due on the 5th unless told otherwise. */
  async function card(userId: string, name: string, owed: number, asOf: Date, over: { visibility?: string; statementDay?: number | null; paymentDueDay?: number | null; mode?: string; minimum?: number } = {}) {
    const { account } = await ok(userId, "POST", "/api/accounts", {
      name, type: "card", currentBalance: owed, cardPaymentMode: over.mode ?? "full",
      ...(over.minimum !== undefined && { cardMinimumPayment: over.minimum }),
      ...(over.visibility && { visibility: over.visibility }),
    });
    const pool = (await prisma.account.findUniqueOrThrow({ where: { id: account.id } })).userId;
    const debt = await prisma.debt.findFirstOrThrow({ where: { userId: pool, accountId: account.id } });
    await prisma.debt.update({ where: { id: debt.id }, data: { balanceAsOf: asOf } });
    await ok(userId, "PATCH", `/api/debts/${debt.id}`, {
      statementDay: over.statementDay === undefined ? 25 : over.statementDay,
      paymentDueDay: over.paymentDueDay === undefined ? 5 : over.paymentDueDay,
    });
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

  it("splits what's due from purchases after the cut-off; the timeline commits only the earlier debt", async () => {
    setClockForTests(NOV_2);
    const { A } = await couple();
    // Owed 100 on Oct 20 (due Nov 5), 50 bought before the Oct 25 cut-off,
    // 20 after it (due Dec 5), 30 paid on Nov 2.
    const visa = await card(A, "Visa", 100, D("2026-10-20"));
    await purchase(A, visa.accountId, 50, D("2026-10-22"));
    await purchase(A, visa.accountId, 20, D("2026-10-30"));
    await pay(A, visa.debtId, 30, D("2026-11-02"));

    const d = (await debtsOf(A)).find(x => x.id === visa.debtId);
    assert.equal(d.owed, 140);
    assert.deepEqual(d.cycle, {
      dueOn: "2026-11-05",
      closesOn: "2026-10-25",
      closed: true,
      dueAmount: 120,     // 100 + 50 up to the cut-off − 30 paid
      minimumDue: null,
      afterCutAmount: 20, // the purchase after the cut-off
      afterCutDueOn: "2026-12-05",
    });

    // Purchases are spending in their categories, never committed: November
    // holds the earlier debt due Nov 5 (100; paying during it doesn't shrink
    // it), exactly the budget line; then nothing.
    const tl = await timelineOf(A);
    assert.deepEqual(tl.map(p => p.period), ["2026-11", "2026-12", "2027-01"]);
    assert.deepEqual(itemAmounts(tl, visa.debtId), [100, 0, 0]);
    assert.equal(d.monthlyCommitment, 100);
  });

  it("debt typed after this period's due date: the cycle moves its due date, not the budget line", async () => {
    setClockForTests(NOV_20);
    const { A } = await couple();
    const visa = await card(A, "Nueva", 1000, NOV_20);
    await purchase(A, visa.accountId, 40, D("2026-11-21"));

    const d = (await debtsOf(A)).find(x => x.id === visa.debtId);
    assert.equal(d.cycle.dueOn, "2026-12-05");
    assert.equal(d.cycle.dueAmount, 1040); // the cut-off (Nov 25) hasn't come: the purchase is in too
    assert.equal(d.cycle.closed, false);
    assert.equal(d.cycle.dueAmount + d.cycle.afterCutAmount, d.owed);
    // The budget line keeps main's rule; the timeline's current period equals it.
    assert.equal(d.monthlyCommitment, 1000);
    assert.deepEqual(itemAmounts(await timelineOf(A), visa.debtId), [1000, 0, 0]);
    const line = await prisma.allocation.findFirstOrThrow({ where: { debtId: visa.debtId } });
    assert.equal(line.allocatedAmount, 100000); // cents; the stored fallback agrees

    // Corrected down to owe only the purchase: the line and the timeline drop to 0.
    await ok(A, "PATCH", `/api/debts/${visa.debtId}`, { currentBalance: 40 });
    const fixed = (await debtsOf(A)).find(x => x.id === visa.debtId);
    assert.equal(fixed.owed, 40);
    assert.equal(fixed.monthlyCommitment, 0);
    assert.deepEqual(itemAmounts(await timelineOf(A), visa.debtId), [0, 0, 0]);
  });

  it("a minimum card shows its minimum due and keeps committing what its budget line holds", async () => {
    setClockForTests(NOV_2);
    const { A } = await couple();
    const m = await card(A, "Revolving", 300, D("2026-10-01"), { mode: "minimum", minimum: 60 });
    const d = (await debtsOf(A)).find(x => x.id === m.debtId);
    assert.equal(d.cycle.minimumDue, 60);
    assert.equal(d.cycle.dueAmount, 300);
    assert.deepEqual(itemAmounts(await timelineOf(A), m.debtId), [60, 60, 60]);
    assert.equal(d.monthlyCommitment, 60);
  });

  it("a card without a statement day keeps today's behaviour", async () => {
    setClockForTests(NOV_20);
    const { A } = await couple();
    const plain = await card(A, "Amex", 80, D("2026-11-10"), { statementDay: null });
    await purchase(A, plain.accountId, 15, D("2026-11-15"));

    const d = (await debtsOf(A)).find(x => x.id === plain.debtId);
    assert.equal(d.statementDay, null);
    assert.equal(d.cycle, null);
    assert.equal(d.owed, 95);
    // Paid in full without a cycle: only the pre-existing debt, this period.
    assert.deepEqual(itemAmounts(await timelineOf(A), plain.debtId), [80, 0, 0]);
    assert.equal(d.monthlyCommitment, 80);
  });

  it("a member's private card stays out of the partner's debts and timeline; a shared one is in", async () => {
    setClockForTests(NOV_20);
    const { A, B } = await couple();
    const secret = await card(B, "Privada", 60, NOV_20, { visibility: "private" });
    const shared = await card(B, "Común", 40, D("2026-10-28"));
    await purchase(B, secret.accountId, 25, D("2026-11-26"));

    // The owner sees both, with their cycle.
    const mine = await debtsOf(B);
    assert.equal(mine.find(x => x.id === secret.debtId)?.cycle?.dueAmount, 60);
    assert.equal(mine.find(x => x.id === secret.debtId)?.cycle?.afterCutAmount, 25);
    assert.deepEqual(itemAmounts(await timelineOf(B), secret.debtId), [60, 0, 0]);

    // The partner: the shared card with its cycle, no trace of the private one.
    const theirs = await debtsOf(A);
    assert.equal(theirs.some(x => x.id === secret.debtId), false);
    assert.equal(theirs.find(x => x.id === shared.debtId)?.cycle?.dueOn, "2026-12-05");
    const tl = await timelineOf(A);
    assert.equal(tl.some(p => (p.items as any[]).some(i => i.debtId === secret.debtId || i.name === "Privada")), false);
    assert.deepEqual(itemAmounts(tl, shared.debtId), [40, 0, 0]); // due Nov 5, unpaid
  });

  it("statementDay is accepted on PATCH, clamped to 1-28 and clearable", async () => {
    setClockForTests(NOV_2);
    const { A } = await couple();
    const c = await card(A, "Clamp", 0, D("2026-10-20"), { statementDay: 31 });
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: c.debtId } })).statementDay, 28);
    await ok(A, "PATCH", `/api/debts/${c.debtId}`, { statementDay: null });
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: c.debtId } })).statementDay, null);
  });
});
