// Debt detail and payoff plan endpoints (LPBETA-02) against a REAL Postgres:
// GET /api/debts/:id/detail (real past from the ledger, projection,
// simulator, history) and GET /api/debts/plan (visible active debts only,
// cards paid in full and debts missing data left out), plus input
// validation. Opt-in like cardCycle.integration.test.ts: skipped unless
// TEST_DATABASE_URL is set; every table is TRUNCATEd, so localhost only.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55447/budget_test npm run test:integration
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const NOV_6 = new Date("2026-11-06T12:00:00Z");

describe("debt detail and payoff plan (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
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
    setClockForTests(NOV_6);
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

  async function couple() {
    const A = await signUp("Ana");
    const B = await signUp("Bea");
    await ok(A.id, "POST", "/api/partner/invite", { email: B.email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: A.id, status: "pending" } });
    await ok(B.id, "POST", "/api/partner/accept", { token: inv.token });
    return { A: A.id, B: B.id };
  }

  /** A loan paid by its minimum, anchored on `asOf`. */
  async function loan(userId: string, name: string, owed: number, over: Record<string, unknown> = {}, asOf = D("2026-09-01")) {
    const { debt } = await ok(userId, "POST", "/api/debts", {
      name, kind: "installment", paymentMode: "minimum", currentBalance: owed, apr: 20, minimumPayment: 100, ...over,
    });
    await prisma.debt.update({ where: { id: debt.id }, data: { balanceAsOf: asOf } });
    return debt.id as string;
  }

  async function pay(userId: string, debtId: string, amount: number, date: Date) {
    const pool = (await prisma.debt.findUniqueOrThrow({ where: { id: debtId } })).userId;
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: pool, debtId } });
    const bank = await prisma.account.findFirstOrThrow({ where: { userId: pool, ownerUserId: userId, type: { not: "card" } } });
    return ok(userId, "POST", "/api/expenses", { amount, description: "Cuota", allocationId: line.id, accountId: bank.id, date: iso(date) });
  }

  // ── detail ─────────────────────────────────────────────────────────────

  it("detail: real past from payments, the projection, the simulator and the history", async () => {
    const A = (await signUp("Carla")).id;
    const id = await loan(A, "Coche", 3000);
    await pay(A, id, 100, D("2026-09-15"));
    await pay(A, id, 100, D("2026-10-15"));

    const { data } = await ok(A, "GET", `/api/debts/${id}/detail`);
    assert.equal(data.debt.owed, 2800);
    assert.equal(data.debt.paymentsTotal, 200);
    assert.equal(data.startMonth, "2026-11");
    assert.deepEqual(data.past, [
      { month: "2026-09", owed: 2900 }, { month: "2026-10", owed: 2800 }, { month: "2026-11", owed: 2800 },
    ]);
    assert.equal(data.projection.status, "ok");
    const baseProj = data.projection.base;
    assert.ok(baseProj.converged);
    assert.deepEqual(baseProj.series[0], { month: "2026-11", owed: 2800 });
    assert.ok(baseProj.totalInterestPaid > 0);
    assert.deepEqual(data.history.map((h: any) => [h.type, h.amount, h.date]), [["payment", 100, "2026-10-15"], ["payment", 100, "2026-09-15"]]);
    assert.equal(data.assumesNoNewPurchases, false);

    const sim = (await ok(A, "GET", `/api/debts/${id}/detail?extra=50&oneOff=500&oneOffMonth=2027-06`)).data;
    assert.ok(sim.projection.simulated.months < sim.projection.base.months);
    assert.ok(sim.projection.simulated.totalInterestPaid < sim.projection.base.totalInterestPaid);
    assert.deepEqual(sim.simulator, { method: "snowball", extraPayment: 50, oneOffAmount: 500, oneOffMonth: "2027-06" });
    // Only for looking: nothing was written.
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id } })).minimumPayment, 10000);
  });

  it("detail: a debt without APR asks for it instead of giving a date", async () => {
    const A = (await signUp("Dani")).id;
    const id = await loan(A, "Préstamo", 1000, { apr: null });
    const { data } = await ok(A, "GET", `/api/debts/${id}/detail`);
    assert.equal(data.projection.status, "needs_data");
    assert.deepEqual(data.projection.missing, ["apr"]);
    assert.equal(data.projection.base, null);
  });

  it("month 0: a BNPL with Nov/Dec/Jan unpaid ends in January before and after paying November; a November one-off only while it's pending", async () => {
    const A = (await signUp("Hugo")).id;
    const { debt } = await ok(A, "POST", "/api/debts", {
      name: "Zapatillas", kind: "bnpl", paymentMode: "installments", installmentAmount: 50, installmentsTotal: 3, apr: 25,
    });
    await prisma.debt.update({ where: { id: debt.id }, data: { balanceAsOf: D("2026-10-20") } });

    const before = (await ok(A, "GET", `/api/debts/${debt.id}/detail`)).data;
    assert.equal(before.debt.owed, 150);
    assert.equal(before.projection.firstMonth, "2026-11");
    assert.equal(before.projection.base.months, 3);
    assert.equal(before.projection.base.payoffMonth, "2027-01");
    assert.equal(before.projection.base.totalInterestPaid, 0); // cuotas carry the interest
    assert.equal((await call(A, "GET", `/api/debts/${debt.id}/detail?oneOff=50&oneOffMonth=2026-11`)).status, 200);
    const planBefore = (await ok(A, "GET", "/api/debts/plan")).data;
    assert.equal(planBefore.plan.payoffMonth, "2027-01");

    await pay(A, debt.id, 50, D("2026-11-03"));
    const after = (await ok(A, "GET", `/api/debts/${debt.id}/detail`)).data;
    assert.equal(after.projection.firstMonth, "2026-12");
    assert.equal(after.projection.base.months, 2);
    assert.equal(after.projection.base.payoffMonth, "2027-01");
    const refused = await call(A, "GET", `/api/debts/${debt.id}/detail?oneOff=50&oneOffMonth=2026-11`);
    assert.equal(refused.status, 400);
    assert.equal(refused.body.code, "invalid_month");
    assert.equal((await call(A, "GET", "/api/debts/plan?oneOff=50&oneOffMonth=2026-11")).body.code, "invalid_month");
    assert.equal((await ok(A, "GET", "/api/debts/plan")).data.plan.payoffMonth, "2027-01");
  });

  it("history: the 200 most recent across payments and adjustments, newest first", async () => {
    const A = (await signUp("Irene")).id;
    const id = await loan(A, "Préstamo", 100000, { minimumPayment: 1 }, D("2020-01-01"));
    const pool = (await prisma.debt.findUniqueOrThrow({ where: { id } })).userId;
    const bank = await prisma.account.findFirstOrThrow({ where: { userId: pool, type: { not: "card" } } });
    // 150 payments (2020-…) and 150 adjustments, interleaved by day.
    const day = (i: number) => new Date(Date.UTC(2020, 1, 1 + i));
    await prisma.expense.createMany({ data: Array.from({ length: 150 }, (_, i) => ({ userId: pool, amount: 100, description: `p${i}`, debtId: id, accountId: bank.id, date: day(2 * i) })) });
    await prisma.debtAdjustment.createMany({ data: Array.from({ length: 150 }, (_, i) => ({ userId: pool, debtId: id, amount: 1, date: day(2 * i + 1) })) });
    const { history } = (await ok(A, "GET", `/api/debts/${id}/detail`)).data;
    assert.equal(history.length, 200);
    const dates = history.map((h: any) => h.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(history[0].type, "adjustment");
    assert.equal(history[0].date, iso(day(299))); // the newest adjustment
    assert.equal(history.filter((h: any) => h.type === "payment").length, 100);
    assert.equal(history.filter((h: any) => h.type === "adjustment").length, 100);
  });

  // ── visibility ─────────────────────────────────────────────────────────

  it("a partner's private debt never reaches B: not in B's plan, its detail is a 404", async () => {
    const { A, B } = await couple();
    const shared = await loan(A, "Compartida", 2000);
    const secret = await loan(A, "Secreta", 5000, { visibility: "private" });
    const own = await loan(B, "De Bea", 800);

    const planB = (await ok(B, "GET", "/api/debts/plan")).data;
    const idsB = [...planB.included, ...planB.excluded].map((d: any) => d.id).sort();
    assert.deepEqual(idsB, [shared, own].sort());
    assert.ok(!JSON.stringify(planB).includes(secret));
    assert.ok(!JSON.stringify(planB).includes("Secreta"));
    assert.equal(planB.plan.series[0].owed, 2800);

    assert.equal((await call(B, "GET", `/api/debts/${secret}/detail`)).status, 404);
    assert.equal((await call(B, "GET", `/api/debts/${shared}/detail`)).status, 200);

    const planA = (await ok(A, "GET", "/api/debts/plan")).data;
    assert.deepEqual(planA.included.map((d: any) => d.id).sort(), [shared, secret, own].sort());
  });

  // ── plan ───────────────────────────────────────────────────────────────

  it("plan: method, extra and one-off; a card paid in full and a debt without minimum are left out", async () => {
    const A = (await signUp("Elena")).id;
    const small = await loan(A, "Pequeña", 600, { apr: 5, minimumPayment: 50 });
    const big = await loan(A, "Grande", 4000, { apr: 24, minimumPayment: 80 });
    const noMin = await loan(A, "Sin mínimo", 900, { minimumPayment: null });
    const { account } = await ok(A, "POST", "/api/accounts", { name: "Visa", type: "card", currentBalance: 300, cardPaymentMode: "full" });
    const card = await prisma.debt.findFirstOrThrow({ where: { accountId: account.id } });

    const sb = (await ok(A, "GET", "/api/debts/plan?method=snowball&extra=100")).data;
    assert.deepEqual(sb.included.map((d: any) => d.id), [small, big]);
    assert.deepEqual(sb.excluded.map((d: any) => [d.id, d.reason]).sort(), [[card.id, "paid_in_full"], [noMin, "needs_data"]].sort());
    assert.equal(sb.plan.payoffOrder[0].id, small);
    assert.equal(sb.plan.series.at(-1).owed, 0);
    assert.equal(sb.other.method, "avalanche");
    assert.ok(sb.minimumsOnly.months > sb.plan.months);

    const av = (await ok(A, "GET", "/api/debts/plan?method=avalanche&extra=100")).data;
    assert.equal(av.method, "avalanche");
    assert.ok(av.plan.totalInterestPaid <= sb.plan.totalInterestPaid);
    assert.equal(av.plan.totalInterestPaid, sb.other.totalInterestPaid);

    const withBonus = (await ok(A, "GET", "/api/debts/plan?method=avalanche&extra=100&oneOff=1000&oneOffMonth=2026-12")).data;
    assert.ok(withBonus.plan.months < av.plan.months);
  });

  it("validates the simulator inputs", async () => {
    const A = (await signUp("Fran")).id;
    const id = await loan(A, "Préstamo", 1000);
    for (const q of ["extra=-1", "extra=abc", "extra=100001", "oneOff=50000000", "oneOff=100", "oneOff=100&oneOffMonth=2026-10", "oneOff=100&oneOffMonth=2026-13"]) {
      const r = await call(A, "GET", `/api/debts/plan?${q}`);
      assert.equal(r.status, 400, q);
      assert.ok(["invalid_amount", "invalid_month"].includes(r.body.code), q);
      assert.equal((await call(A, "GET", `/api/debts/${id}/detail?${q}`)).status, 400, q);
    }
    assert.equal((await call(A, "GET", "/api/debts/plan?method=random")).body.code, "invalid_method");
    // Unknown debt.
    assert.equal((await call(A, "GET", "/api/debts/nope/detail")).status, 404);
  });

  it("plan: no debts gives an empty plan, not an error", async () => {
    const A = (await signUp("Gema")).id;
    const { data } = await ok(A, "GET", "/api/debts/plan");
    assert.equal(data.plan, null);
    assert.deepEqual(data.included, []);
  });
});
