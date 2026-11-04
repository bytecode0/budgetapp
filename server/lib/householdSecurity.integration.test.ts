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

  // ── Private in every tier (review round): rows, totals, AI, rules ──────

  /** A transparent couple where A has a private loan (with its line and one
   *  payment) and a private card (with a purchase), and A's main account. */
  async function privateSetup() {
    const c = await couple("transparent");
    const loan = (await ok(c.A, "POST", "/api/debts", {
      name: "Préstamo secreto", kind: "installment", paymentMode: "installments",
      installmentAmount: 150, installmentsTotal: 12, installmentsPaid: 0, visibility: "private",
    })).debt.id;
    const line = (await prisma.allocation.findFirstOrThrow({ where: { userId: c.A, debtId: loan } })).id;
    const aMain = (await prisma.account.findFirstOrThrow({ where: { userId: c.A, ownerUserId: c.A, type: "checking" } })).id;
    const payment = (await ok(c.A, "POST", "/api/expenses", { amount: 150, description: "Cuota secreta", allocationId: line, accountId: aMain })).expense.id;
    const card = (await ok(c.A, "POST", "/api/accounts", { name: "Visa secreta", type: "card", currentBalance: 0, cardPaymentMode: "full", visibility: "private" })).account.id;
    const cardDebt = await prisma.debt.findFirstOrThrow({ where: { accountId: card } });
    assert.equal(cardDebt.visibility, "private", "a card's debt follows its account");
    const purchase = (await ok(c.A, "POST", "/api/expenses", { amount: 30, description: "Tienda secreta", accountId: card })).expense.id;
    return { ...c, loan, line, aMain, payment, card, cardDebt: cardDebt.id, purchase };
  }

  it("h. NOT-filters keep the rows with no debt, line or account", async () => {
    const c = await couple("transparent");
    await ok(c.A, "POST", "/api/debts", {
      name: "Privada", kind: "installment", paymentMode: "installments",
      installmentAmount: 10, installmentsTotal: 3, installmentsPaid: 0, visibility: "private",
    });
    // Rows with every relation null: Prisma's NOT over an optional relation must keep them.
    const bare = await prisma.expense.create({ data: { userId: c.A, amount: 700, description: "Sin nada", merchant: "sin nada", payerUserId: c.A, createdByUserId: c.A } });
    const bareIncome = await prisma.income.create({ data: { userId: c.A, ownerUserId: c.A, amount: 800, description: "Sin cuenta", merchant: "sin cuenta", category: "other", source: "manual" } });
    assert.ok((await listIds(c.B, "/api/expenses", "expenses")).has(bare.id));
    assert.ok((await listIds(c.B, "/api/income", "incomes")).has(bareIncome.id));
    const plainLines = await prisma.allocation.count({ where: { userId: c.A, debtId: null } });
    const bLines = (await ok(c.B, "GET", "/api/allocations")).allocations as any[];
    assert.equal(bLines.filter(l => !l.debtId).length, plainLines, "every line without a debt is listed");
  });

  it("i. A's rows on her private debt and card: never listed to B, nor changed by B in any way", async () => {
    const c = await privateSetup();
    // A second identical purchase: a duplicate pair only A may see.
    const twin = (await ok(c.A, "POST", "/api/expenses", { amount: 30, description: "Tienda secreta", accountId: c.card })).expense.id;
    const secretIncome = (await ok(c.A, "POST", "/api/income", { amount: 50, description: "Ingreso secreto", accountId: c.card })).income.id;

    const bList = await listIds(c.B, "/api/expenses", "expenses");
    for (const id of [c.payment, c.purchase, twin]) assert.ok(!bList.has(id), `expense ${id} listed to B`);
    assert.ok(bList.has(c.aExpense), "A's other expenses still are (transparent)");
    assert.deepEqual((await ok(c.B, "GET", `/api/expenses?allocationId=${c.line}`)).expenses, []);
    const aList = await listIds(c.A, "/api/expenses", "expenses");
    for (const id of [c.payment, c.purchase, twin]) assert.ok(aList.has(id), "A sees all hers");

    const dupIds = async (u: string) => JSON.stringify((await ok(u, "GET", "/api/expenses/duplicates")).groups);
    assert.ok((await dupIds(c.A)).includes(twin));
    assert.ok(!(await dupIds(c.B)).includes(twin));

    assert.ok(!(await listIds(c.B, "/api/income", "incomes")).has(secretIncome));
    assert.ok((await listIds(c.A, "/api/income", "incomes")).has(secretIncome));

    const cardBalance = await liveBalance(c.A, c.cardDebt);
    const loanBalance = await liveBalance(c.A, c.loan);
    for (const id of [c.purchase, c.payment]) {
      assert.equal((await call(c.B, "PATCH", `/api/expenses/${id}`, { amount: 1 })).status, 404);
      assert.equal((await call(c.B, "PATCH", `/api/expenses/${id}/attribution`, { scope: "personal" })).status, 404);
      assert.equal((await call(c.B, "DELETE", `/api/expenses/${id}`)).status, 404);
    }
    const merge = await call(c.B, "POST", "/api/expenses/merge", { keepId: c.purchase, removeIds: [twin] });
    assert.notEqual(merge.status, 200, JSON.stringify(merge.body));
    assert.equal(await prisma.expense.count({ where: { id: { in: [c.purchase, twin, c.payment] } } }), 3);
    assert.equal(await liveBalance(c.A, c.cardDebt), cardBalance, "the private card's debt never moved");
    assert.equal(await liveBalance(c.A, c.loan), loanBalance);
  });

  it("j. B's budget totals still hold A's private commitments, as one unnamed figure", async () => {
    const c = await privateSetup();
    const aAlloc = await ok(c.A, "GET", "/api/allocations");
    const bAlloc = await ok(c.B, "GET", "/api/allocations");
    const sum = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100);
    assert.equal(aAlloc.hiddenCommitted, 0);
    assert.ok(bAlloc.hiddenCommitted >= 150, `hiddenCommitted ${bAlloc.hiddenCommitted}`);
    assert.equal(sum(bAlloc.allocations, "allocatedAmount") + Math.round(bAlloc.hiddenCommitted * 100), sum(aAlloc.allocations, "allocatedAmount"));

    const month = periodKey();
    const bMonth = await ok(c.B, "GET", `/api/monthly-budgets?month=${month}`);
    const bReview = await ok(c.B, "GET", `/api/monthly-budgets/review?month=${month}`);
    assert.equal(sum(bMonth.budgets, "allocatedAmount") + Math.round(bMonth.hiddenCommitted * 100), Math.round(bReview.totalBudgeted * 100));
    // A month budget saved for the hidden line counts as saved.
    const aMonth = await ok(c.A, "POST", "/api/monthly-budgets/save", { month, budgets: [{ allocationId: c.line, allocatedAmount: 400 }] });
    assert.ok(aMonth.budgets.some((b: any) => b.allocationId === c.line));
    const bMonth2 = await ok(c.B, "GET", `/api/monthly-budgets?month=${month}`);
    assert.ok(!JSON.stringify(bMonth2).includes(c.line));
    const bReview2 = await ok(c.B, "GET", `/api/monthly-budgets/review?month=${month}`);
    assert.equal(Math.round((bMonth2.hiddenCommitted - bMonth.hiddenCommitted) * 100), 40000 - 15000, "the saved 400 replaces the 150 cuota");
    assert.equal(sum(bMonth2.budgets, "allocatedAmount") + Math.round(bMonth2.hiddenCommitted * 100), Math.round(bReview2.totalBudgeted * 100));
  });

  it("k. the AI classifier never gets nor returns a line hidden from the caller", async () => {
    const c = await privateSetup();
    const http = await import("node:http");
    const sent: string[] = [];
    const fake = http.createServer((req, res) => {
      let body = "";
      req.on("data", d => { body += d; });
      req.on("end", () => {
        sent.push(body);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          id: "msg_test", type: "message", role: "assistant", model: "test", stop_reason: "tool_use", stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "tool_use", id: "tu_1", name: "submit_classifications", input: { classifications: [{ merchant: "cofidis", allocationId: c.line }] } }],
        }));
      });
    });
    fake.listen(0);
    await new Promise<void>(resolve => fake.once("listening", () => resolve()));
    const saved = { key: process.env.ANTHROPIC_API_KEY, url: process.env.ANTHROPIC_BASE_URL };
    process.env.ANTHROPIC_API_KEY = "sk-ant-integration-test";
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    try {
      const r = await ok(c.B, "POST", "/api/expenses/import/classify", { merchants: ["cofidis"] });
      assert.equal(sent.length, 1, "the provider was called");
      assert.ok(!sent[0].includes(c.line) && !sent[0].includes("Préstamo secreto") && !sent[0].includes("Visa secreta"), "a hidden line reached the AI");
      assert.deepEqual(r.suggestions, []);
    } finally {
      if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
      if (saved.url === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = saved.url;
      await new Promise<void>(resolve => fake.close(() => resolve()));
    }
  });

  it("l. rules and recurring commitments on a hidden line or private account: not shown to B, not B's to change", async () => {
    const c = await privateSetup();
    const rule = (await ok(c.A, "POST", "/api/rules", { pattern: "cofidis", allocationId: c.line })).rule.id;
    const ruleIds = async (u: string) => new Set(((await ok(u, "GET", "/api/rules")).rules as any[]).map(r => r.id));
    assert.ok((await ruleIds(c.A)).has(rule));
    assert.ok(!(await ruleIds(c.B)).has(rule));
    assert.equal((await call(c.B, "PATCH", `/api/rules/${rule}`, { pattern: "x" })).status, 404);
    assert.equal((await call(c.B, "DELETE", `/api/rules/${rule}`)).status, 404);

    // Three monthly charges: one merchant on the hidden line, one only on the private card.
    for (let m = 1; m <= 3; m++) {
      const date = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - m, 5));
      await prisma.expense.create({ data: { userId: c.A, amount: 15000, description: "Cofidis", merchant: "cofidis", date, allocationId: c.line, debtId: c.loan, accountId: c.aMain, payerUserId: c.A, createdByUserId: c.A } });
      await prisma.expense.create({ data: { userId: c.A, amount: 4000, description: "Gimnasio secreto", merchant: "gimnasio secreto", date, accountId: c.card, payerUserId: c.A, createdByUserId: c.A } });
    }
    const merchants = async (u: string) => ((await ok(u, "GET", "/api/recurring")).commitments as any[]).map(x => x.merchant);
    const aMerchants = await merchants(c.A);
    assert.ok(aMerchants.includes("cofidis") && aMerchants.includes("gimnasio secreto"), JSON.stringify(aMerchants));
    const bBody = JSON.stringify(await ok(c.B, "GET", "/api/recurring"));
    assert.ok(!bBody.includes("cofidis") && !bBody.includes("gimnasio secreto") && !bBody.includes("Préstamo secreto"), bBody);
    for (const merchant of ["cofidis", "gimnasio secreto"]) {
      const commitment = await prisma.recurringCommitment.findFirstOrThrow({ where: { userId: c.A, merchant } });
      assert.equal((await call(c.B, "PATCH", `/api/recurring/${commitment.id}`, { status: "ignored" })).status, 404);
      assert.equal((await prisma.recurringCommitment.findUniqueOrThrow({ where: { id: commitment.id } })).status, "detected");
    }
  });

  it("m. B's import preview never attaches A's hidden payments or debts", async () => {
    const c = await privateSetup();
    // A pays her private card from her main account.
    const cardLine = (await prisma.allocation.findFirstOrThrow({ where: { debtId: c.cardDebt } })).id;
    await ok(c.A, "POST", "/api/expenses", { amount: 200, description: "Pago Visa", allocationId: cardLine, accountId: c.aMain });
    const cardPayment = (await prisma.expense.findFirstOrThrow({ where: { debtId: c.cardDebt, amount: 20000 } })).id;
    const bMain = (await prisma.account.findFirstOrThrow({ where: { ownerUserId: c.B, type: "checking" } })).id;
    const r = await ok(c.B, "POST", "/api/expenses/import/preview", {
      accountId: bMain,
      rows: [
        { rowIndex: 0, date: today(), amountCents: -20000, description: "PAGO TARJETA CREDITO" },
        { rowIndex: 1, date: today(), amountCents: -15000, description: "Cuota secreta" },
      ],
    });
    const body = JSON.stringify(r);
    for (const secret of [c.cardDebt, cardPayment, c.loan, c.payment, c.line, "Préstamo secreto", "Visa secreta", "Cuota secreta\",\"source"]) {
      assert.ok(!body.includes(secret), `preview leaks ${secret}: ${body}`);
    }
  });

  it("n. B's import of a bank row A already entered by hand as a payment of her private card is a duplicate, redacted", async () => {
    const c = await privateSetup();
    // A pays her private card from her (household-shared) main account, by hand: no externalId.
    const cardLine = (await prisma.allocation.findFirstOrThrow({ where: { debtId: c.cardDebt } })).id;
    const handPayment = (await ok(c.A, "POST", "/api/expenses", { amount: 200, description: "Pago Visa", allocationId: cardLine, accountId: c.aMain })).expense.id;
    const r = await ok(c.B, "POST", "/api/expenses/import/preview", {
      accountId: c.aMain,
      rows: [{ rowIndex: 0, date: today(), amountCents: -20000, description: "RECIBO VISA" }],
    });
    assert.equal(r.rows[0].status, "duplicate", JSON.stringify(r.rows[0]));
    assert.equal(r.rows[0].debtId, null);
    assert.equal(r.newCount, 0);
    const body = JSON.stringify(r);
    for (const secret of [handPayment, c.cardDebt, cardLine, "Pago Visa", "Visa secreta"]) assert.ok(!body.includes(secret), `preview leaks ${secret}`);
    // What the screen would send (only new rows): nothing, so nothing is inserted twice.
    const before = await prisma.expense.count({ where: { accountId: c.aMain } });
    const newRows = (r.rows as any[]).filter(x => x.status === "new");
    assert.equal(newRows.length, 0);
    assert.equal(await prisma.expense.count({ where: { accountId: c.aMain } }), before);
  });

  it("o. B never re-points A's rule on her hidden line, by correction or import, and creating it reveals nothing", async () => {
    const c = await privateSetup();
    const rule = (await ok(c.A, "POST", "/api/rules", { matchType: "equals", pattern: "cofidis", allocationId: c.line })).rule.id;
    const bLines = (await ok(c.B, "GET", "/api/allocations")).allocations as any[];
    const groceries = bLines.find(l => l.isDefault && l.type === "flexible").id;
    const fixed = bLines.find(l => l.isDefault && l.type === "fixed").id;

    // A manual correction by B of her own "Cofidis" expense.
    const mine = (await ok(c.B, "POST", "/api/expenses", { amount: 15, description: "Cofidis", allocationId: fixed })).expense.id;
    await ok(c.B, "PATCH", `/api/expenses/${mine}`, { allocationId: groceries });
    // An import by B that would teach "cofidis" → groceries.
    const imported = await ok(c.B, "POST", "/api/expenses/import/confirm", {
      rows: [{ kind: "expense", externalId: "o-1", date: today(), description: "Cofidis", merchant: "cofidis", amount: 15, allocationId: groceries }],
    });
    assert.ok(!(imported.learned as any[]).some(l => l.merchant === "cofidis"));
    assert.equal((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule } })).allocationId, c.line, "A's rule untouched");

    const clash = await call(c.B, "POST", "/api/rules", { matchType: "equals", pattern: "cofidis", allocationId: groceries });
    assert.equal(clash.status, 404, JSON.stringify(clash.body));
    assert.equal(clash.body.code, "rule_unavailable");
    assert.ok(!JSON.stringify(clash.body).includes(c.line));
    // A clash with a rule B can see is still the plain 409.
    await ok(c.B, "POST", "/api/rules", { matchType: "equals", pattern: "mercadona", allocationId: groceries });
    assert.equal((await call(c.B, "POST", "/api/rules", { matchType: "equals", pattern: "mercadona", allocationId: fixed })).status, 409);
    assert.equal((await prisma.categorizationRule.findUniqueOrThrow({ where: { id: rule } })).allocationId, c.line);
  });

  it("p. recurring: B's figures come only from what B sees; a person alone keeps every commitment", async () => {
    const c = await privateSetup();
    const monthAgo = (m: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - m, 5));
    // The same merchant: B's own 10 € charges, and A's 12 € ones on her private card.
    for (let m = 1; m <= 3; m++) {
      await prisma.expense.create({ data: { userId: c.A, amount: 1000, description: "Netflix", merchant: "netflix", date: monthAgo(m), payerUserId: c.B, createdByUserId: c.B } });
      await prisma.expense.create({ data: { userId: c.A, amount: 1200, description: "Netflix", merchant: "netflix", date: monthAgo(m), accountId: c.card, payerUserId: c.A, createdByUserId: c.A } });
    }
    // A merchant B has one movement of, the rest on A's private card.
    await prisma.expense.create({ data: { userId: c.A, amount: 4000, description: "Gym", merchant: "gym", date: monthAgo(1), payerUserId: c.B, createdByUserId: c.B } });
    for (let m = 1; m <= 3; m++) {
      await prisma.expense.create({ data: { userId: c.A, amount: 4000, description: "Gym", merchant: "gym", date: monthAgo(m), accountId: c.card, payerUserId: c.A, createdByUserId: c.A } });
    }
    const find = async (u: string, merchant: string) =>
      ((await ok(u, "GET", "/api/recurring")).commitments as any[]).find(x => x.merchant === merchant);
    assert.equal((await find(c.A, "netflix")).avgAmount, 11, "the pool's figure for A");
    assert.equal((await find(c.B, "netflix")).avgAmount, 10, "B's figure only from B's rows");
    assert.ok(await find(c.A, "gym"));
    assert.equal(await find(c.B, "gym"), undefined, "B can't detect it from what she sees");

    // A commitment whose movements are gone stays, for a person alone and for A.
    const solo = await signUp("Sol");
    for (let m = 1; m <= 3; m++) {
      await prisma.expense.create({ data: { userId: solo.id, amount: 900, description: "Spotify", merchant: "spotify", date: monthAgo(m), payerUserId: solo.id, createdByUserId: solo.id } });
      await prisma.expense.create({ data: { userId: c.A, amount: 900, description: "Spotify", merchant: "spotify", date: monthAgo(m), accountId: c.aMain, payerUserId: c.A, createdByUserId: c.A } });
    }
    assert.ok(await find(solo.id, "spotify"));
    assert.ok(await find(c.A, "spotify"));
    await prisma.expense.deleteMany({ where: { merchant: "spotify" } });
    assert.ok(await find(solo.id, "spotify"), "alone: still listed");
    assert.ok(await find(c.A, "spotify"), "A: still listed");
  });
});
