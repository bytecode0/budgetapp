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

  // ── LPBETA-19: private debts and accounts ──────────────────────────────

  it("d. A's private debt: its line is not listed to B, but still counts in the totals", async () => {
    const c = await couple("transparent");
    const loan = (await ok(c.A, "POST", "/api/debts", {
      name: "Préstamo secreto", kind: "installment", paymentMode: "installments",
      installmentAmount: 150, installmentsTotal: 12, installmentsPaid: 0, visibility: "private",
    })).debt.id;
    const line = (await prisma.allocation.findFirstOrThrow({ where: { userId: c.A, debtId: loan } })).id;
    const aMain = (await prisma.account.findFirstOrThrow({ where: { userId: c.A, ownerUserId: c.A, type: "checking" } })).id;
    await ok(c.A, "POST", "/api/expenses", { amount: 150, description: "Cuota préstamo", allocationId: line, accountId: aMain });

    const lineIds = async (u: string) => new Set(((await ok(u, "GET", "/api/allocations")).allocations as any[]).map(a => a.id));
    assert.ok((await lineIds(c.A)).has(line), "its owner sees the line");
    assert.ok(!(await lineIds(c.B)).has(line), "B doesn't");

    const month = periodKey();
    const budgetIds = async (u: string) => new Set(((await ok(u, "GET", `/api/monthly-budgets?month=${month}`)).budgets as any[]).map(b => b.allocationId));
    assert.ok((await budgetIds(c.A)).has(line));
    assert.ok(!(await budgetIds(c.B)).has(line));

    const aReview = await ok(c.A, "GET", `/api/monthly-budgets/review?month=${month}`);
    const bReview = await ok(c.B, "GET", `/api/monthly-budgets/review?month=${month}`);
    assert.ok((aReview.review as any[]).some(r => r.allocationId === line));
    assert.ok(!(bReview.review as any[]).some(r => r.allocationId === line));
    assert.equal(bReview.totalBudgeted, aReview.totalBudgeted, "the commitment still counts in the household total");
    assert.equal(bReview.totalActual, aReview.totalActual);

    const aStats = await ok(c.A, "GET", `/api/analytics?from=${month}&to=${month}`);
    const bStats = await ok(c.B, "GET", `/api/analytics?from=${month}&to=${month}`);
    assert.ok((aStats.byCategory as any[]).some(r => r.allocationId === line));
    assert.ok(!(bStats.byCategory as any[]).some(r => r.allocationId === line));
    assert.deepEqual(bStats.months, aStats.months);
    assert.deepEqual(bStats.alignment, aStats.alignment);

    const bDash = await ok(c.B, "GET", `/api/dashboard/household?period=${month}`);
    const aDash = await ok(c.A, "GET", `/api/dashboard/household?period=${month}`);
    assert.ok((aDash.byCategory as any[]).some(r => r.allocationId === line));
    assert.ok(!(bDash.byCategory as any[]).some(r => r.allocationId === line));
    assert.equal(bDash.health.expenses, aDash.health.expenses);

    for (const body of [JSON.stringify(await ok(c.B, "GET", "/api/allocations")), JSON.stringify(bReview), JSON.stringify(bStats), JSON.stringify(bDash)]) {
      assert.ok(!body.includes("Préstamo secreto"), "the name never reaches B");
    }
  });

  it("e. B can't pay, re-line or edit A's private debt by expense, import or budget line", async () => {
    const c = await couple("transparent");
    const loan = (await ok(c.A, "POST", "/api/debts", {
      name: "Préstamo secreto", kind: "installment", paymentMode: "installments",
      installmentAmount: 150, installmentsTotal: 12, installmentsPaid: 0, visibility: "private",
    })).debt.id;
    const line = (await prisma.allocation.findFirstOrThrow({ where: { userId: c.A, debtId: loan } })).id;
    const aMain = (await prisma.account.findFirstOrThrow({ where: { userId: c.A, ownerUserId: c.A, type: "checking" } })).id;
    const aPayment = (await ok(c.A, "POST", "/api/expenses", { amount: 150, description: "Cuota", allocationId: line, accountId: aMain })).expense.id;
    const balance = await liveBalance(c.A, loan);
    const expensesBefore = await prisma.expense.count();

    const lineMissing = (r: { status: number; body: any }, what: string) => {
      assert.equal(r.status, 404, `${what}: ${r.status} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "allocation_not_found", what);
    };
    lineMissing(await call(c.B, "POST", "/api/expenses", { amount: 150, description: "x", allocationId: line }), "POST /api/expenses");
    lineMissing(await call(c.B, "PATCH", `/api/expenses/${c.bExpense}`, { allocationId: line }), "PATCH /api/expenses/:id");
    lineMissing(await call(c.B, "POST", "/api/expenses/import/confirm", {
      rows: [{ kind: "expense", externalId: "x-1", date: today(), description: "x", amount: 150, allocationId: line }],
    }), "import an expense on the line");

    const payByImport = await call(c.B, "POST", "/api/expenses/import/confirm", {
      rows: [{ kind: "payment", externalId: "x-2", date: today(), description: "x", amount: 150, debtId: loan }],
    });
    assert.equal(payByImport.status, 404, JSON.stringify(payByImport.body));
    assert.equal(payByImport.body.code, "debt_not_found");
    assert.ok(!JSON.stringify(payByImport.body).includes("Préstamo secreto"));

    const newLine = await call(c.B, "POST", "/api/allocations", { name: "Mine now", type: "debt", debtId: loan });
    assert.equal(newLine.status, 400, JSON.stringify(newLine.body));

    // A's existing payment and line: not B's to change.
    assert.equal((await call(c.B, "PATCH", `/api/expenses/${aPayment}`, { amount: 1 })).status, 404);
    assert.equal((await call(c.B, "DELETE", `/api/expenses/${aPayment}`)).status, 404);
    assert.equal((await call(c.B, "PATCH", `/api/allocations/${line}`, { name: "Renamed" })).status, 404);
    assert.equal((await call(c.B, "DELETE", `/api/allocations/${line}`)).status, 404);
    lineMissing(await call(c.B, "POST", "/api/monthly-budgets/save", { month: periodKey(), budgets: [{ allocationId: line, allocatedAmount: 0 }] }), "save a month budget");

    assert.equal(await liveBalance(c.A, loan), balance, "the private debt's balance never moved");
    assert.equal(await prisma.expense.count(), expensesBefore, "nothing was written");
    assert.equal((await prisma.allocation.findUniqueOrThrow({ where: { id: line } })).name, "Préstamo secreto");
    assert.equal(await prisma.allocation.count({ where: { debtId: loan } }), 1);

    // Its owner still can.
    await ok(c.A, "PATCH", `/api/expenses/${aPayment}`, { amount: 100 });
    assert.equal(await liveBalance(c.A, loan), balance + 5000);
  });

  it("f. B can't record income on A's private account (nor learn its name); a shared one works", async () => {
    const c = await couple("transparent");
    const secret = (await ok(c.A, "POST", "/api/accounts", { name: "Cuenta secreta", type: "savings", visibility: "private" })).account.id;
    const shared = (await ok(c.A, "POST", "/api/accounts", { name: "Común", type: "checking" })).account.id;

    const onSecret = await ok(c.B, "POST", "/api/income", { amount: 10, description: "x", accountId: secret });
    assert.equal(onSecret.income.accountId, null);
    assert.equal(onSecret.income.account, null);
    const patched = await ok(c.B, "PATCH", `/api/income/${c.bIncome}`, { accountId: secret });
    assert.notEqual(patched.income.accountId, secret);
    assert.ok(!JSON.stringify([onSecret, patched]).includes("Cuenta secreta"));
    assert.equal(await prisma.income.count({ where: { accountId: secret } }), 0);

    const onShared = await ok(c.B, "POST", "/api/income", { amount: 10, description: "y", accountId: shared });
    assert.equal(onShared.income.accountId, shared);
    // Its owner can use her private one.
    assert.equal((await ok(c.A, "POST", "/api/income", { amount: 10, description: "z", accountId: secret })).income.accountId, secret);
  });

  // ── LPBETA-20: the invite is for the invited email ─────────────────────

  it("g. only the invited email accepts; the public invite shows only the inviter's name", async () => {
    const A = await signUp("Ana");
    const B = await signUp("Bea");
    const C = await signUp("Carla");
    // Typed with capitals and spaces: still B's.
    const token = await invite(A.id, `  ${B.email.toUpperCase()} `);

    const shown = await call(null, "GET", `/api/partner/invite/${token}`);
    assert.equal(shown.status, 200);
    assert.deepEqual(shown.body, { invite: { senderName: "Ana" } });

    const wrong = await call(C.id, "POST", "/api/partner/accept", { token });
    assert.equal(wrong.status, 403, JSON.stringify(wrong.body));
    assert.equal(wrong.body.code, "invite_wrong_email");
    assert.ok(!JSON.stringify(wrong.body).toLowerCase().includes(B.email), "the invited email is never revealed");
    assert.equal((await prisma.partnerInvite.findUniqueOrThrow({ where: { token } })).status, "pending");
    assert.equal((await prisma.userSettings.findUnique({ where: { userId: C.id } }))?.linkedUserId ?? null, null);

    const accepted = await ok(B.id, "POST", "/api/partner/accept", { token });
    assert.equal(accepted.success, true);
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: B.id } })).linkedUserId, A.id);
  });
});
