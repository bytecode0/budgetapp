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

  it("pay yourself first: X = the month's deposits and plan-line transfers, Y = the share of the income", async () => {
    const B = await signUp("Bea", "bea@example.com");
    await ok(B, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3000 });

    let m = (await ok(B, "GET", `/api/dashboard/month?month=${month()}`)).data;
    assert.deepEqual(m, { month: month(), householdIncome: 3000, paidYourself: 0, payYourselfFirstBps: null, payYourselfFirstGoal: null, generosityAmount: 0, generosityBps: null });

    assert.equal((await call(B, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: 150 })).status, 400);
    assert.equal((await call(B, "PATCH", "/api/onboarding/preferences", {})).status, 400);
    assert.deepEqual((await ok(B, "PATCH", "/api/onboarding/preferences", { payYourselfFirstPct: 12.5 })).data, { payYourselfFirstBps: 1250, generosityBps: null });

    const plan = (await ok(B, "POST", "/api/plans", { title: "Colchón", type: "emergency", targetAmount: 6000, monthlyContribution: 100, autoCreateAllocation: true })).plan;
    await ok(B, "POST", "/api/plan-deposits/confirm", { month: month(), deposits: [{ planId: plan.id, amount: 200 }] });
    const line = await prisma.allocation.findFirstOrThrow({ where: { userId: B, lifePlanId: plan.id } });
    await prisma.expense.create({ data: { userId: B, allocationId: line.id, amount: 5000, description: "Transfer", createdByUserId: B, payerUserId: B } });
    await prisma.expense.create({ data: { userId: B, allocationId: line.id, amount: 1000, kind: "refund", description: "Back out", createdByUserId: B, payerUserId: B } });

    m = (await ok(B, "GET", `/api/dashboard/month?month=${month()}`)).data;
    assert.equal(m.paidYourself, 240);           // 200 + 50 − 10
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
});
