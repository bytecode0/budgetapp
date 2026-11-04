// The onboarding's goals against a REAL Postgres (LPBETA-07, LPBETA-10):
// the opening goal, "Págate a ti primero" and Home's "Te has pagado X de Y",
// the emergency-fund suggestion, and plan deposits keeping a plan's starting
// amount. Opt-in: skipped unless TEST_DATABASE_URL is set.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55443/budget_test npm run test:integration
//
// The database must be a throwaway local one with the schema pushed: every
// table is TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("income shares and first goals (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let periodLib: typeof import("./period.js");
  let confirmImport: typeof import("./ingest/confirm.js").confirmImport;
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
    ({ confirmImport } = await import("./ingest/confirm.js"));
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

  async function signUp(name: string, email: string) {
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    return user.id;
  }

  const month = () => periodLib.currentPeriodKey(1);

  it("stores the opening goal and rejects unknown ones", async () => {
    const A = await signUp("Ana", "ana@example.com");
    assert.equal((await call(A, "PATCH", "/api/onboarding/answers", { goal: "lottery" })).status, 400);
    const r = await ok(A, "PATCH", "/api/onboarding/answers", { goal: "emergency" });
    assert.deepEqual(r.data, { noCards: false, noLoans: false, goal: "emergency" });
    const status = await ok(A, "GET", "/api/onboarding/status");
    assert.equal(status.data.answers.goal, "emergency");
    await ok(A, "PATCH", "/api/onboarding/answers", { goal: null });
    assert.equal((await ok(A, "GET", "/api/onboarding/status")).data.answers.goal, null);
  });

  it("pay yourself first: X = each plan's max(deposit, plan-line transfers), Y = the share of the income", async () => {
    const B = await signUp("Bea", "bea@example.com");
    await ok(B, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });

    let m = (await ok(B, "GET", `/api/dashboard/month?month=${month()}`)).data;
    assert.deepEqual(m, { month: month(), householdIncome: 3000, paidYourself: 0, payYourselfFirstBps: null, payYourselfFirstGoal: null, payYourselfFirstApplies: false, generosityAmount: 0, generosityBps: null });

    assert.equal((await call(B, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: 150 })).status, 400);
    assert.equal((await call(B, "PATCH", "/api/onboarding/preferences", {})).status, 400);
    assert.deepEqual((await ok(B, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: 12.5 })).data, { payYourselfFirstBps: 1250, generosityBps: null });

    const plan = (await ok(B, "POST", "/api/plans", { title: "Colchón", type: "emergency", targetAmount: 6000, monthlyContribution: 100, autoCreateAllocation: true })).plan;
    await ok(B, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: plan.id, amount: 200 }] });
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: B, lifePlanId: plan.id } });
    await prisma.expense.create({ data: { userId: B, allocationId: line.id, amount: 5000, description: "Transfer", createdByUserId: B, payerUserId: B } });
    await prisma.expense.create({ data: { userId: B, allocationId: line.id, amount: 1000, kind: "refund", description: "Back out", createdByUserId: B, payerUserId: B } });

    m = (await ok(B, "GET", `/api/dashboard/month?month=${month()}`)).data;
    assert.equal(m.paidYourself, 200);           // max(deposit 200, booked 50 − 10)
    assert.equal(m.payYourselfFirstGoal, 375);   // 12.5 % of 3,000
    assert.equal((await call(B, "GET", "/api/dashboard/month?month=junk")).status, 400);

    // Recorded income for the month replaces the baseline, as on Home.
    await prisma.income.create({ data: { userId: B, ownerUserId: B, amount: 400000, date: new Date() } });
    m = (await ok(B, "GET", `/api/dashboard/month?month=${month()}`)).data;
    assert.equal(m.householdIncome, 4000);
    assert.equal(m.payYourselfFirstGoal, 500);
  });

  it("a plan deposit moves the plan by the change, keeping its starting amount", async () => {
    const C = await signUp("Carla", "carla@example.com");
    const plan = (await ok(C, "POST", "/api/plans", { title: "Fondo", type: "emergency", targetAmount: 6000, currentAmount: 1500 })).plan;
    await ok(C, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: plan.id, amount: 200 }] });
    let p = await prisma.lifePlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(p.currentAmount, 170000);
    // Correcting the same month's deposit moves it by the difference only.
    await ok(C, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: plan.id, amount: 250 }] });
    p = await prisma.lifePlan.findUniqueOrThrow({ where: { id: plan.id } });
    assert.equal(p.currentAmount, 175000);
  });

  it("the onboarding result suggests 3 months of expenses and offers what's already saved", async () => {
    const D = await signUp("Dani", "dani@example.com");
    await ok(D, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    await ok(D, "POST", "/api/allocations", { name: "Alquiler", type: "fixed", allocatedAmount: 900 });
    await ok(D, "POST", "/api/allocations", { name: "Súper", type: "flexible", allocatedAmount: 400 });
    await ok(D, "POST", "/api/accounts", { name: "Ahorros", type: "cash", currentBalance: 2500 });

    let r = (await ok(D, "GET", "/api/onboarding/result")).data;
    assert.equal(r.monthlyExpenses, 1300);
    assert.equal(r.emergencyFundSuggested, 3900);
    assert.equal(r.savedSoFar, 2500);
    assert.equal(r.hasEmergencyPlan, false);
    assert.equal(r.leftover, 1700);

    await ok(D, "POST", "/api/plans", { title: "Fondo de emergencia", type: "emergency", targetAmount: 3900, currentAmount: 2500 });
    r = (await ok(D, "GET", "/api/onboarding/result")).data;
    assert.equal(r.hasEmergencyPlan, true);
  });

  // ── LPBETA-10: the Generosity line ─────────────────────────────────────

  it("every budget gets one Generosity line at 0, first, even under concurrent reads", async () => {
    const E = await signUp("Eva", "eva@example.com");
    const reads = await Promise.all([1, 2, 3, 4].map(() => ok(E, "GET", "/api/allocations")));
    const lines = await prisma.allocation.findMany({ where: { userId: E, type: "generosity" } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].allocatedAmount, 0);
    assert.equal(lines[0].name, "Generosidad");
    const all = reads[3].allocations as { type: string }[];
    assert.equal(all[0].type, "generosity");
    assert.equal(reads[3].generosityBps, null);
    // Signup's default lines are still there.
    assert.deepEqual(all.slice(1).map(a => a.type).sort(), ["fixed", "flexible"]);
  });

  it("the Generosity line can't be deleted, retyped, duplicated, nor can another line become one", async () => {
    const F = await signUp("Fran", "fran@example.com");
    const { allocations } = await ok(F, "GET", "/api/allocations");
    const gen = allocations.find((a: any) => a.type === "generosity");
    const fixed = allocations.find((a: any) => a.type === "fixed");
    assert.equal((await call(F, "DELETE", `/api/allocations/${gen.id}`)).status, 400);
    assert.equal((await call(F, "PATCH", `/api/allocations/${gen.id}`, { type: "flexible" })).status, 400);
    assert.equal((await call(F, "PATCH", `/api/allocations/${fixed.id}`, { type: "generosity" })).status, 400);
    assert.equal((await call(F, "POST", "/api/allocations", { name: "Dar", type: "generosity", allocatedAmount: 10 })).status, 400);
    // Saving it with its own type (what the budget screen sends) still works.
    await ok(F, "PATCH", `/api/allocations/${gen.id}`, { name: "Dar", type: "generosity" });
    assert.equal(await prisma.allocation.count({ where: { userId: F, type: "generosity" } }), 1);
  });

  it("a share of the household's income keeps its % when the income changes; a typed amount replaces it", async () => {
    const G = await signUp("Gema", "gema@example.com");
    await ok(G, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    assert.equal((await call(G, "PATCH", "/api/onboarding/preferences", { generosityPct: -1 })).status, 400);
    const saved = (await ok(G, "PATCH", "/api/onboarding/preferences", { generosityPct: 10 })).data;
    assert.deepEqual(saved, { payYourselfFirstBps: null, generosityBps: 1000, generosityAmount: 300 });

    await ok(G, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 4000 });
    const { allocations, generosityBps } = await ok(G, "GET", "/api/allocations");
    const gen = allocations.find((a: any) => a.type === "generosity");
    assert.equal(gen.allocatedAmount, 400);
    assert.equal(generosityBps, 1000);

    const review = await ok(G, "GET", `/api/monthly-budgets/review?month=${month()}`);
    assert.equal(review.review.find((r: any) => r.type === "generosity").budgeted, 400);
    const budgets = await ok(G, "GET", `/api/monthly-budgets?month=${month()}`);
    assert.equal(budgets.budgets.find((b: any) => b.allocation.type === "generosity").allocatedAmount, 400);
    assert.equal((await ok(G, "GET", `/api/dashboard/month?month=${month()}`)).data.generosityAmount, 400);
    assert.equal((await ok(G, "GET", "/api/onboarding/result")).data.generosityAmount, 400);

    // Renaming it (the amount sent unchanged) keeps the share…
    await ok(G, "PATCH", `/api/allocations/${gen.id}`, { name: "Dar", allocatedAmount: 400 });
    assert.equal((await ok(G, "GET", "/api/allocations")).generosityBps, 1000);
    // …typing another amount makes it that fixed amount.
    await ok(G, "PATCH", `/api/allocations/${gen.id}`, { allocatedAmount: 50 });
    await ok(G, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 5000 });
    const after = await ok(G, "GET", "/api/allocations");
    assert.equal(after.generosityBps, null);
    assert.equal(after.allocations.find((a: any) => a.type === "generosity").allocatedAmount, 50);

    // "Ahora no" = 0 %.
    const notNow = (await ok(G, "PATCH", "/api/onboarding/preferences", { generosityPct: 0 })).data;
    assert.deepEqual(notNow, { payYourselfFirstBps: null, generosityBps: 0, generosityAmount: 0 });
    assert.equal((await ok(G, "GET", `/api/dashboard/month?month=${month()}`)).data.generosityAmount, 0);
  });

  it("saving the share before ever opening the budget still seeds the default lines", async () => {
    const user = await prisma.user.create({ data: { name: "Hugo", email: "hugo@example.com", emailVerified: new Date() } });
    await ok(user.id, "PATCH", "/api/onboarding/preferences", { generosityPct: 5 });
    const types = (await prisma.allocation.findMany({ where: { userId: user.id }, select: { type: true } })).map(a => a.type).sort();
    assert.deepEqual(types, ["fixed", "flexible", "generosity"]);
  });

  // ── Review fixes ───────────────────────────────────────────────────────

  it("money booked from the bank and registered by hand counts once (max of the two)", async () => {
    const I = await signUp("Inés", "ines@example.com");
    await ok(I, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    const plan = (await ok(I, "POST", "/api/plans", { title: "Colchón", type: "emergency", targetAmount: 6000, monthlyContribution: 200, autoCreateAllocation: true })).plan;
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: I, lifePlanId: plan.id } });
    const status = async () => (await ok(I, "GET", `/api/plans/monthly-status?month=${month()}`)).status[0];

    // Bank booked 150 of the expected 200: pending, only the remainder.
    await ok(I, "POST", "/api/expenses", { amount: 150, description: "Transferencia", allocationId: line.id });
    let st = await status();
    assert.equal(st.status, "pending");
    assert.equal(st.depositedAmount, 150);
    assert.equal(st.remainingAmount, 50);

    // Bank books the other 50, and the user also registers 200 by hand.
    await ok(I, "POST", "/api/expenses", { amount: 50, description: "Transferencia", allocationId: line.id });
    await ok(I, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: plan.id, amount: 200 }] });
    st = await status();
    assert.equal(st.status, "contributed");
    assert.equal(st.depositedAmount, 200);
    assert.equal(st.remainingAmount, 0);
    assert.equal((await ok(I, "GET", `/api/dashboard/month?month=${month()}`)).data.paidYourself, 200);
    // The plan's balance moved by 200, not 400.
    assert.equal((await prisma.lifePlan.findUniqueOrThrow({ where: { id: plan.id } })).currentAmount, 20000);
    // Registering a month total above what was booked adds only the difference.
    await ok(I, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: plan.id, amount: 260 }] });
    assert.equal((await prisma.lifePlan.findUniqueOrThrow({ where: { id: plan.id } })).currentAmount, 26000);
  });

  it("two concurrent confirms of the same deposit move the plan once", async () => {
    const J = await signUp("Jon", "jon@example.com");
    const plan = (await ok(J, "POST", "/api/plans", { title: "Fondo", type: "emergency", targetAmount: 6000, currentAmount: 1000 })).plan;
    const body = { month: month(), deposits: [{ planId: plan.id, amount: 300 }] };
    await Promise.all([ok(J, "POST", "/api/plan-deposits/confirm", body), ok(J, "POST", "/api/plan-deposits/confirm", body)]);
    assert.equal((await prisma.lifePlan.findUniqueOrThrow({ where: { id: plan.id } })).currentAmount, 130000);
  });

  it("the share's own amount echoed back by the budget screen keeps the share; the batch never touches the line", async () => {
    const K = await signUp("Kai", "kai@example.com");
    await ok(K, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    await ok(K, "PATCH", "/api/onboarding/preferences", { generosityPct: 10 });
    const gen = (await ok(K, "GET", "/api/allocations")).allocations.find((a: any) => a.type === "generosity");
    // Next month has recorded income: its share is 500, not this month's 300.
    const next = periodLib.periodKeyOffset(month(), 1);
    await prisma.income.create({ data: { userId: K, ownerUserId: K, amount: 500000, date: periodLib.periodBounds(next, 1).start } });
    await ok(K, "PATCH", `/api/allocations/${gen.id}`, { allocatedAmount: 500, month: next });
    await ok(K, "PATCH", `/api/allocations/${gen.id}`, { allocatedAmount: 300 });
    assert.equal((await ok(K, "GET", "/api/allocations")).generosityBps, 1000);
    // The batch (budget suggestions) skips the line.
    await ok(K, "PATCH", "/api/allocations/budgets", { budgets: [{ id: gen.id, allocatedAmount: 999 }] });
    const after = await ok(K, "GET", "/api/allocations");
    assert.equal(after.generosityBps, 1000);
    assert.equal(after.allocations.find((a: any) => a.type === "generosity").allocatedAmount, 300);

    // A saved month without a Generosity row still returns its derived amount.
    const fixed = after.allocations.find((a: any) => a.type === "fixed");
    await ok(K, "POST", "/api/monthly-budgets/save", { month: next, budgets: [{ allocationId: fixed.id, allocatedAmount: 900 }] });
    const saved = await ok(K, "GET", `/api/monthly-budgets?month=${next}`);
    assert.equal(saved.budgets.find((b: any) => b.allocationId === gen.id).allocatedAmount, 500);
    assert.equal(saved.budgets.find((b: any) => b.allocationId === fixed.id).allocatedAmount, 900);
  });

  it("a share chosen after a month ended doesn't judge that month", async () => {
    const L = await signUp("Lía", "lia@example.com");
    await ok(L, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    await ok(L, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: 10 });
    const prev = periodLib.periodKeyOffset(month(), -1);
    assert.equal((await ok(L, "GET", `/api/dashboard/month?month=${prev}`)).data.payYourselfFirstApplies, false);
    assert.equal((await ok(L, "GET", `/api/dashboard/month?month=${month()}`)).data.payYourselfFirstApplies, true);
    // Saving the same share again keeps its date; changing it moves it.
    const setAt = (await prisma.userSettings.findUniqueOrThrow({ where: { userId: L } })).payYourselfFirstSetAt;
    await ok(L, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: 10 });
    assert.deepEqual((await prisma.userSettings.findUniqueOrThrow({ where: { userId: L } })).payYourselfFirstSetAt, setAt);
    await ok(L, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: null });
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: L } })).payYourselfFirstSetAt, null);
  });

  it("the onboarding result uses this month's household income, as Home does", async () => {
    const M = await signUp("Mar", "mar@example.com");
    await ok(M, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    await prisma.income.create({ data: { userId: M, ownerUserId: M, amount: 350000, date: new Date() } });
    const r = (await ok(M, "GET", "/api/onboarding/result")).data;
    assert.equal(r.monthlyIncome, 3500);
    assert.equal((await ok(M, "GET", `/api/monthly-budgets/review?month=${month()}`)).householdIncome, 3500);
  });

  it("when she joins, her Generosity month budgets move to the pool's line for months it has none", async () => {
    const P = await signUp("Pau", "pau@example.com");
    const Q = await signUp("Quim", "quim@example.com");
    const pGen = (await ok(P, "GET", "/api/allocations")).allocations.find((a: any) => a.type === "generosity");
    const qGen = (await ok(Q, "GET", "/api/allocations")).allocations.find((a: any) => a.type === "generosity");
    const prev = periodLib.periodKeyOffset(month(), -1);
    await ok(P, "POST", "/api/monthly-budgets/save", { month: prev, budgets: [{ allocationId: pGen.id, allocatedAmount: 70 }] });
    await ok(Q, "POST", "/api/monthly-budgets/save", { month: prev, budgets: [{ allocationId: qGen.id, allocatedAmount: 20 }] });
    await ok(Q, "POST", "/api/monthly-budgets/save", { month: month(), budgets: [{ allocationId: qGen.id, allocatedAmount: 40 }] });

    await ok(P, "POST", "/api/partner/invite", { email: "quim@example.com" });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: P, status: "pending" } });
    await ok(Q, "POST", "/api/partner/accept", { token: inv.token });

    assert.equal(await prisma.allocation.count({ where: { userId: P, type: "generosity" } }), 1);
    const rows = await prisma.monthlyBudget.findMany({ where: { allocationId: pGen.id }, orderBy: { month: "asc" } });
    assert.deepEqual(rows.map(r => [r.month, r.allocatedAmount, r.userId]), [[prev, 7000, P], [month(), 4000, P]]);
  });

  it("in a couple the Generosity line is never hidden and never in hiddenCommitted", async () => {
    const R = await signUp("Rut", "rut@example.com");
    const S = await signUp("Sol", "sol@example.com");
    await ok(R, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });
    await ok(R, "POST", "/api/partner/invite", { email: "sol@example.com" });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId: R, status: "pending" } });
    await ok(S, "POST", "/api/partner/accept", { token: inv.token });
    await ok(R, "PATCH", "/api/onboarding/preferences", { generosityPct: 10 });
    // R's private loan: its line is hidden from S, its 10 € a month comes as one figure.
    await ok(R, "POST", "/api/debts", {
      name: "Privada", kind: "installment", paymentMode: "installments",
      installmentAmount: 10, installmentsTotal: 3, installmentsPaid: 0, visibility: "private",
    });
    const asS = await ok(S, "GET", "/api/allocations");
    const gen = (asS.allocations as any[]).filter(a => a.type === "generosity");
    assert.equal(gen.length, 1);
    assert.equal(gen[0].allocatedAmount, 300);
    assert.equal(asS.hiddenCommitted, 10);
    const budgets = await ok(S, "GET", `/api/monthly-budgets?month=${month()}`);
    assert.equal(budgets.hiddenCommitted, 10);
    assert.equal(budgets.budgets.find((b: any) => b.allocation.type === "generosity").allocatedAmount, 300);
  });

  // ── One ledger for plan balances (server/lib/planLedger.ts) ─────────────

  /** start + Σ over months of the contribution, recomputed from the rows:
   *  with a deposit max(deposit, booked), without one booked. */
  async function expectedBalance(planId: string, start: number): Promise<number> {
    const [deposits, expenses] = await Promise.all([
      prisma.planDeposit.findMany({ where: { planId } }),
      prisma.expense.findMany({ where: { allocation: { lifePlanId: planId, type: "plan" } } }),
    ]);
    const booked = new Map<string, number>();
    for (const e of expenses) {
      const m = periodLib.periodKeyFor(e.date, 1);
      booked.set(m, (booked.get(m) ?? 0) + (e.kind === "refund" ? -e.amount : e.amount));
    }
    const deposit = new Map(deposits.map(d => [d.month, d.amount]));
    let total = start;
    for (const m of new Set([...booked.keys(), ...deposit.keys()])) {
      total += deposit.has(m) ? Math.max(deposit.get(m)!, booked.get(m) ?? 0) : (booked.get(m) ?? 0);
    }
    return total;
  }

  async function planWithLine(user: string, start = 0) {
    const plan = (await ok(user, "POST", "/api/plans", { title: "Colchón", type: "emergency", targetAmount: 6000, currentAmount: start, monthlyContribution: 200, autoCreateAllocation: true })).plan;
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: user, lifePlanId: plan.id } });
    const balance = async () => (await prisma.lifePlan.findUniqueOrThrow({ where: { id: plan.id } })).currentAmount;
    const consistent = async (cents: number) => {
      assert.equal(await balance(), cents);
      assert.equal(await balance(), await expectedBalance(plan.id, start * 100));
    };
    return { plan, line, balance, consistent };
  }

  const today = () => new Date().toISOString().slice(0, 10);
  const importRows = (user: string, rows: { externalId: string; amountCents: number; allocationId: string; kind?: string }[]) =>
    confirmImport({ userId: user, authUserId: user, householdId: null, accountId: null, source: "bank_sync" },
      rows.map(r => ({ kind: r.kind ?? "expense", externalId: r.externalId, date: today(), description: "Transferencia", amountCents: r.amountCents, allocationId: r.allocationId })));

  it("deposit then the bank imports the same transfer: the plan moves once", async () => {
    const U = await signUp("Uxue", "uxue@example.com");
    const p = await planWithLine(U, 1000);
    await ok(U, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: p.plan.id, amount: 200 }] });
    await p.consistent(120000);
    const r = await importRows(U, [{ externalId: "bank-1", amountCents: 20000, allocationId: p.line.id }]);
    assert.ok(!("error" in r), JSON.stringify(r));
    await p.consistent(120000);
    assert.equal((await ok(U, "GET", `/api/dashboard/month?month=${month()}`)).data.paidYourself, 200);
    // Re-importing the same movement is a no-op.
    await importRows(U, [{ externalId: "bank-1", amountCents: 20000, allocationId: p.line.id }]);
    await p.consistent(120000);
  });

  it("import then deposit: the deposit adds only what goes beyond the booked money", async () => {
    const V = await signUp("Vera", "vera@example.com");
    const p = await planWithLine(V);
    await importRows(V, [{ externalId: "bank-2", amountCents: 15000, allocationId: p.line.id }]);
    await p.consistent(15000);
    await ok(V, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: p.plan.id, amount: 200 }] });
    await p.consistent(20000);
    await ok(V, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: p.plan.id, amount: 100 }] });
    await p.consistent(15000); // the deposit below the booked money: booked counts
  });

  it("deleting or editing booked money after a deposit keeps the balance on the rule", async () => {
    const W = await signUp("Wen", "wen@example.com");
    const p = await planWithLine(W);
    await ok(W, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: p.plan.id, amount: 200 }] });
    const e1 = (await ok(W, "POST", "/api/expenses", { amount: 150, description: "Transferencia", allocationId: p.line.id })).expense.id;
    await p.consistent(20000);
    await ok(W, "PATCH", `/api/expenses/${e1}`, { amount: 250 });
    await p.consistent(25000);
    await ok(W, "PATCH", `/api/expenses/${e1}`, { amount: 120 });
    await p.consistent(20000);
    // Moved off the plan line, and back.
    const fixed = (await ok(W, "GET", "/api/allocations")).allocations.find((a: any) => a.type === "fixed");
    await ok(W, "PATCH", `/api/expenses/${e1}`, { allocationId: fixed.id });
    await p.consistent(20000);
    await ok(W, "PATCH", `/api/expenses/${e1}`, { allocationId: p.line.id, amount: 300 });
    await p.consistent(30000);
    await ok(W, "DELETE", `/api/expenses/${e1}`);
    await p.consistent(20000);
  });

  it("merging duplicate transfers on a plan line keeps the balance on the rule", async () => {
    const X = await signUp("Xavi", "xavi@example.com");
    const p = await planWithLine(X);
    const a = (await ok(X, "POST", "/api/expenses", { amount: 200, description: "Transferencia ahorro", allocationId: p.line.id })).expense.id;
    const b = (await ok(X, "POST", "/api/expenses", { amount: 200, description: "Transferencia ahorro", allocationId: p.line.id })).expense.id;
    await p.consistent(40000);
    await ok(X, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: p.plan.id, amount: 200 }] });
    await p.consistent(40000);
    await ok(X, "POST", "/api/expenses/merge", { keepId: a, removeIds: [b] });
    await p.consistent(20000);
  });

  it("a withdrawal on the plan line offsets: without a deposit the month can be negative", async () => {
    const Y = await signUp("Yago", "yago@example.com");
    const p = await planWithLine(Y, 1000);
    await importRows(Y, [
      { externalId: "bank-3", amountCents: 20000, allocationId: p.line.id },
      { externalId: "bank-4", amountCents: 50000, allocationId: p.line.id, kind: "refund" },
    ]);
    await p.consistent(100000 - 30000);
    assert.equal((await ok(Y, "GET", `/api/dashboard/month?month=${month()}`)).data.paidYourself, -300);
    // With a deposit the month is max(deposit, booked).
    await ok(Y, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: p.plan.id, amount: 50 }] });
    await p.consistent(100000 + 5000);
    assert.equal((await ok(Y, "GET", `/api/dashboard/month?month=${month()}`)).data.paidYourself, 50);
  });
});
