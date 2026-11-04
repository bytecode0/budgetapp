// Household security against a REAL Postgres, with two-member households:
// leaving the household ends access to the partner's data (LPBETA-18), a
// member's private debt and account stay invisible and untouchable for the
// other one (LPBETA-19), and only the invited email can accept an invite
// (LPBETA-20). Opt-in like partnerFlow.integration.test.ts: skipped unless
// TEST_DATABASE_URL is set; every table is TRUNCATEd, so localhost only.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/budget_test npm run test:integration
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("household security (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let debtLib: typeof import("./debtBalance.js");
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
    debtLib = await import("./debtBalance.js");
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

  async function call(userId: string | null, method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(userId && { cookie: `token=${signToken({ userId })}` }),
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
  /** What signup does: the user row, then default lines + Main account. */
  async function signUp(name: string) {
    const email = `${name.toLowerCase()}${++seq}@test.local`;
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, "es");
    return { id: user.id, email };
  }

  async function invite(senderId: string, email: string): Promise<string> {
    await ok(senderId, "POST", "/api/partner/invite", { email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId, status: "pending" }, orderBy: { createdAt: "desc" } });
    return inv.token;
  }

  /** A (owner) and B (member) linked in one household, at `tier`, each with
   *  an income and an expense of their own. */
  async function couple(tier: "transparent" | "shared_stats") {
    const A = await signUp("Ana");
    const B = await signUp("Bea");
    await ok(B.id, "POST", "/api/partner/accept", { token: await invite(A.id, B.email) });
    const household = (await ok(A.id, "GET", "/api/households/current")).household;
    await ok(A.id, "PATCH", `/api/households/${household.id}`, { visibilityTier: tier });
    const aExpense = (await ok(A.id, "POST", "/api/expenses", { amount: 40, description: "Mercadona" })).expense.id;
    const bExpense = (await ok(B.id, "POST", "/api/expenses", { amount: 25, description: "Zara" })).expense.id;
    const aIncome = (await ok(A.id, "POST", "/api/income", { amount: 2000, description: "Nómina" })).income.id;
    const bIncome = (await ok(B.id, "POST", "/api/income", { amount: 900, description: "Salary" })).income.id;
    return { A: A.id, B: B.id, householdId: household.id as string, aExpense, bExpense, aIncome, bIncome };
  }

  const listIds = async (userId: string, path: string, key: string) =>
    new Set(((await ok(userId, "GET", path))[key] as { id: string }[]).map(r => r.id));

  const periodKey = () => periodLib.currentPeriodKey(1);
  const today = () => new Date().toISOString().slice(0, 10);

  async function liveBalance(poolId: string, debtId: string): Promise<number> {
    const [ledger] = await debtLib.loadDebtLedgers(poolId, [debtId]);
    return debtLib.debtState(ledger).balance;
  }

  // ── LPBETA-18: leaving the household ───────────────────────────────────

  it("a. a member who leaves the household no longer reads the partner's data", async () => {
    const c = await couple("shared_stats");
    await ok(c.B, "DELETE", `/api/households/members/${c.B}`);

    const settings = await prisma.userSettings.findUniqueOrThrow({ where: { userId: c.B } });
    assert.equal(settings.linkedUserId, null, "the link that gave access to the pool is gone");
    assert.equal(await prisma.householdMember.count({ where: { userId: c.B } }), 0);

    // Her own data, back in her scope; nothing of A's.
    const bExpenses = await listIds(c.B, "/api/expenses", "expenses");
    assert.ok(bExpenses.has(c.bExpense), "her own expense came back with her");
    assert.ok(!bExpenses.has(c.aExpense), "A's expense is not listed to B");
    const bIncomes = await listIds(c.B, "/api/income", "incomes");
    assert.ok(bIncomes.has(c.bIncome));
    assert.ok(!bIncomes.has(c.aIncome), "A's income is not listed to B");
    // A keeps hers.
    const aExpenses = await listIds(c.A, "/api/expenses", "expenses");
    assert.ok(aExpenses.has(c.aExpense) && !aExpenses.has(c.bExpense));
  });

  it("b. a member the owner removes no longer reads or changes the owner's data", async () => {
    const c = await couple("transparent");
    await ok(c.A, "DELETE", `/api/households/members/${c.B}`);

    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: c.B } })).linkedUserId, null);
    const bExpenses = await listIds(c.B, "/api/expenses", "expenses");
    assert.ok(bExpenses.has(c.bExpense) && !bExpenses.has(c.aExpense));
    assert.equal((await call(c.B, "PATCH", `/api/expenses/${c.aExpense}`, { amount: 1 })).status, 404);
    assert.equal((await call(c.B, "DELETE", `/api/expenses/${c.aExpense}`)).status, 404);
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: c.aExpense } })).amount, 4000);
  });

  it("c. a link left without a household membership lists only the viewer's own transactions", async () => {
    const c = await couple("transparent");
    // Defense in depth: the membership gone but linkedUserId still set.
    await prisma.householdMember.deleteMany({ where: { userId: c.B } });
    const bExpenses = await listIds(c.B, "/api/expenses", "expenses");
    assert.ok(bExpenses.has(c.bExpense) && !bExpenses.has(c.aExpense));
    const bIncomes = await listIds(c.B, "/api/income", "incomes");
    assert.ok(bIncomes.has(c.bIncome) && !bIncomes.has(c.aIncome));
  });
});
