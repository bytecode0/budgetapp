// End-to-end partner flow against a REAL Postgres: accept (merge), using the
// pool while linked, unlink, re-accept, the legacy repair script, and
// concurrent accepts. Opt-in: skipped unless TEST_DATABASE_URL is set, so
// `npm run test` and CI stay database-free.
//
//   TEST_DATABASE_URL=postgresql://postgres@localhost:55432/budget_test npm run test:integration
//
// The database must be a throwaway local one with the schema pushed
// (`DATABASE_URL=<it> npx prisma db push --skip-generate`): every table is
// TRUNCATEd at the start, so the host must be localhost (asserted).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("partner flow (integration, real Postgres)", { skip: !TEST_DATABASE_URL && "TEST_DATABASE_URL not set" }, () => {
  // Loaded in before(), after the env points at the test database.
  let prisma: typeof import("./prisma.js").prisma;
  let signToken: typeof import("./jwt.js").signToken;
  let createDefaultAllocations: typeof import("./defaults.js").createDefaultAllocations;
  let debtLib: typeof import("./debtBalance.js");
  let periodLib: typeof import("./period.js");
  let repairPartnerData: typeof import("../scripts/repairPartnerData.js").repairPartnerData;
  let server: Server;
  let base: string;

  before(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      `TEST_DATABASE_URL must point at localhost (got ${url.hostname}): this test truncates every table`);
    // Set before anything imports Prisma or the app (dotenv never overrides a
    // variable that is already set). Email goes to the console, never out.
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
    ({ repairPartnerData } = await import("../scripts/repairPartnerData.js"));
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

  /** What signup does: the user row, then default lines + Main account. */
  async function signUp(name: string, email: string, language: "es" | "en" = "es") {
    const user = await prisma.user.create({ data: { name, email, emailVerified: new Date() } });
    await createDefaultAllocations(user.id, language);
    return user.id;
  }

  const periodKey = () => periodLib.currentPeriodKey(1);

  /** Live balance (server/lib/debtBalance.ts) of every debt in a scope. */
  async function liveBalances(userId: string): Promise<Map<string, number>> {
    const ledgers = await debtLib.loadDebtLedgers(userId);
    return new Map(ledgers.map(l => [l.debt.id, debtLib.debtState(l).balance]));
  }

  /** Counted spending of the current period, as the household dashboard sums
   *  it (countedAmounts: a card payment counts only for the pre-existing debt). */
  async function countedSpending(userId: string): Promise<number> {
    const r = await ok(userId, "GET", `/api/dashboard/household?period=${periodKey()}`);
    return Math.round(r.health.expenses * 100);
  }

  async function invite(senderId: string, email: string): Promise<string> {
    await ok(senderId, "POST", "/api/partner/invite", { email });
    const inv = await prisma.partnerInvite.findFirstOrThrow({ where: { senderId, status: "pending" }, orderBy: { createdAt: "desc" } });
    return inv.token;
  }

  async function defaultLinesByType(userId: string) {
    const lines = await prisma.allocation.findMany({ where: { userId, isDefault: true }, select: { type: true } });
    const out: Record<string, number> = {};
    for (const l of lines) out[l.type] = (out[l.type] ?? 0) + 1;
    return out;
  }

  /** A fingerprint of every row in every table: equal ⇔ nothing was written. */
  async function dbFingerprint(): Promise<string> {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    const parts: string[] = [];
    for (const { tablename } of tables) {
      const [row] = await prisma.$queryRawUnsafe<{ h: string | null }[]>(
        `SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS h FROM "${tablename}" t`);
      parts.push(`${tablename}:${row.h}`);
    }
    return parts.join("\n");
  }

  const IMPORT_HASH = "0123456789abcdef0123456789abcdef";

  // ── shared state across the sequential scenarios a–d ─────────────────
  let A = "", B = "";
  const ids: Record<string, string> = {};
  let balancesBefore = new Map<string, number>();
  let spendingBefore = 0;

  it("a. B accepts A's invite: her onboarding data merges into A's pool", async () => {
    A = await signUp("Ana", "ana@test.local", "es");
    B = await signUp("Bea", "bea@test.local", "en");

    // ── A: income 3230 €, Main, a card with debt + purchases + a payment, a loan.
    await ok(A, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3230 });
    await ok(A, "POST", "/api/income", { amount: 3230, description: "Nómina", category: "salary" });
    const aLines = (await ok(A, "GET", "/api/allocations")).allocations as any[];
    const aFlexible = aLines.find(l => l.isDefault && l.type === "flexible").id;
    const aMain = (await prisma.account.findFirstOrThrow({ where: { userId: A, type: "checking" } })).id;
    const aCard = (await ok(A, "POST", "/api/accounts", { name: "Visa Ana", type: "card", currentBalance: 500, cardPaymentMode: "full" })).account.id;
    const aCardDebt = (await prisma.debt.findFirstOrThrow({ where: { accountId: aCard } })).id;
    await ok(A, "POST", "/api/expenses", { amount: 40, description: "Mercadona", accountId: aCard, allocationId: aFlexible });
    const aCardLine = (await prisma.allocation.findFirstOrThrow({ where: { userId: A, debtId: aCardDebt } })).id;
    // 540 € paid: 500 pays the pre-existing debt (counted), 40 pays the purchase (not counted again).
    await ok(A, "POST", "/api/expenses", { amount: 540, description: "Pago Visa", accountId: aMain, allocationId: aCardLine });
    const aLoan = (await ok(A, "POST", "/api/debts", {
      name: "Préstamo coche", kind: "installment", paymentMode: "installments",
      installmentAmount: 150, installmentsTotal: 12, installmentsPaid: 2,
    })).debt.id;
    await prisma.expense.create({ data: {
      userId: A, amount: 1999, description: "Amazon import", merchant: "amazon", source: "import",
      externalId: IMPORT_HASH, payerUserId: A, createdByUserId: A, accountId: aMain,
    } });

    // ── B, before accepting: her own onboarding.
    await ok(B, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 925 });
    await ok(B, "POST", "/api/income", { amount: 925, description: "Salary", category: "salary" });
    const bLines = (await ok(B, "GET", "/api/allocations")).allocations as any[];
    const bFixed = bLines.find(l => l.isDefault && l.type === "fixed").id;
    const bFlexible = bLines.find(l => l.isDefault && l.type === "flexible").id;
    const bMain = (await prisma.account.findFirstOrThrow({ where: { userId: B, type: "checking" } })).id;
    const bCard = (await ok(B, "POST", "/api/accounts", { name: "Visa Bea", type: "card", currentBalance: 300, cardPaymentMode: "full" })).account.id;
    const bCardDebt = (await prisma.debt.findFirstOrThrow({ where: { accountId: bCard } })).id;
    const bPurchase = (await ok(B, "POST", "/api/expenses", { amount: 25, description: "Zara", accountId: bCard, allocationId: bFlexible })).expense.id;
    // Same import hash A already has: must survive the merge under a namespaced id.
    const bImported = (await prisma.expense.create({ data: {
      userId: B, amount: 1550, description: "Amazon import", merchant: "amazon", source: "import",
      externalId: IMPORT_HASH, payerUserId: B, createdByUserId: B,
    } })).id;
    const bPlan = (await ok(B, "POST", "/api/plans", { title: "Fondo de emergencia", targetAmount: 1000, monthlyContribution: 50, autoCreateAllocation: true })).plan.id;
    await ok(B, "POST", "/api/plan-deposits/confirm", { month: periodKey(), deposits: [{ planId: bPlan, amount: 50 }] });
    const bRule = (await ok(B, "POST", "/api/rules", { pattern: "netflix", allocationId: bFixed })).rule.id;
    Object.assign(ids, { aMain, aCard, aCardDebt, aLoan, aFlexible, bMain, bCard, bCardDebt, bPurchase, bImported, bPlan, bRule, bFixed, bFlexible });

    balancesBefore = new Map([...await liveBalances(A), ...await liveBalances(B)]);
    spendingBefore = await countedSpending(A) + await countedSpending(B);
    assert.equal(balancesBefore.get(aCardDebt), 0);   // 500 + 40 − 540
    assert.equal(balancesBefore.get(bCardDebt), 32500); // 300 + 25
    assert.equal(balancesBefore.get(aLoan), 150000);  // 10 cuotas left × 150
    assert.equal(spendingBefore, 4000 + 50000 + 1999 + 2500 + 1550);

    // ── Accept.
    const token = await invite(A, "bea@test.local");
    const accepted = await ok(B, "POST", "/api/partner/accept", { token });
    assert.equal(accepted.success, true);

    // Both incomes in A's household; baselines summed, own figure per caller.
    const incomes = (await ok(A, "GET", "/api/income")).incomes as any[];
    assert.deepEqual(incomes.map(i => i.ownerUserId).sort(), [A, B].sort());
    const asA = await ok(A, "GET", "/api/allocations");
    assert.equal(asA.monthlyIncome, 4155);
    assert.equal(asA.ownMonthlyIncome, 3230);
    assert.equal(asA.isCouple, true);
    const asB = await ok(B, "GET", "/api/allocations");
    assert.equal(asB.monthlyIncome, 4155);
    assert.equal(asB.ownMonthlyIncome, 925);
    // Saving one's own figure unchanged keeps the household total.
    assert.equal((await ok(B, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 925 })).monthlyIncome, 4155);
    assert.equal((await ok(A, "PATCH", "/api/allocations/settings/income", { monthlyIncome: 3230 })).monthlyIncome, 4155);

    // Untouched default lines merged: one default per type, hers gone; her
    // purchase and rule repointed to the pool's lines.
    assert.deepEqual(await defaultLinesByType(A), { fixed: 1, flexible: 1 });
    assert.equal(await prisma.allocation.count({ where: { userId: B } }), 0);
    assert.equal(await prisma.allocation.count({ where: { id: { in: [bFixed, bFlexible] } } }), 0);
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: bPurchase } })).allocationId, aFlexible);
    const rule = await prisma.categorizationRule.findUniqueOrThrow({ where: { id: bRule } });
    assert.equal(rule.userId, A);
    assert.equal(rule.allocationId, (await prisma.allocation.findFirstOrThrow({ where: { userId: A, isDefault: true, type: "fixed" } })).id);

    // Her untouched Main is her only open non-card account (besides it she
    // has only a card), so it is kept and moved like the rest: private, hers.
    // Her card, debt, plan, deposit moved, still hers.
    const main = await prisma.account.findUniqueOrThrow({ where: { id: bMain } });
    assert.deepEqual([main.userId, main.ownerUserId, main.visibility], [A, B, "private"]);
    const card = await prisma.account.findUniqueOrThrow({ where: { id: bCard } });
    assert.deepEqual([card.userId, card.ownerUserId, card.visibility], [A, B, "private"]);
    const debt = await prisma.debt.findUniqueOrThrow({ where: { id: bCardDebt } });
    assert.deepEqual([debt.userId, debt.ownerUserId, debt.accountId], [A, B, bCard]);
    const plan = await prisma.lifePlan.findUniqueOrThrow({ where: { id: bPlan } });
    assert.deepEqual([plan.userId, plan.ownerUserId], [A, B]);
    assert.equal(await prisma.planDeposit.count({ where: { planId: bPlan, userId: A } }), 1);
    assert.equal(await prisma.allocation.count({ where: { userId: A, lifePlanId: bPlan } }), 1);

    // Her import kept under a namespaced id, A's untouched.
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: bImported } })).externalId, `merged:${B}:${IMPORT_HASH}`);
    assert.equal(await prisma.expense.count({ where: { userId: A, externalId: IMPORT_HASH } }), 1);

    // Nothing left under her own userId.
    for (const model of ["income", "expense", "account", "debt", "lifePlan", "planDeposit", "categorizationRule"] as const) {
      assert.equal(await (prisma[model] as any).count({ where: { userId: B } }), 0, `${model} left under B`);
    }

    // Balances unchanged by the move; spending not double-counted.
    assert.deepEqual(await liveBalances(A), balancesBefore);
    assert.equal(await countedSpending(A), spendingBefore);

    // Household mirrors the link.
    const members = await prisma.householdMember.findMany({ where: { userId: { in: [A, B] } } });
    assert.equal(new Set(members.map(m => m.householdId)).size, 1);
    assert.deepEqual(members.map(m => `${m.userId === A ? "A" : "B"}:${m.role}`).sort(), ["A:owner", "B:member"]);
  });

  let bLinkedExpense = "";

  it("b. while linked, B's expense without accountId is entered by her", async () => {
    const r = await ok(B, "POST", "/api/expenses", { amount: 12, description: "Café" });
    bLinkedExpense = r.expense.id;
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: bLinkedExpense } });
    assert.equal(e.userId, A);
    assert.equal(e.createdByUserId, B);
    assert.ok(e.accountId, "an account is defaulted");
  });

  it("b. while linked, B's expense without accountId defaults to HER account", async () => {
    const e = await prisma.expense.findUniqueOrThrow({ where: { id: bLinkedExpense }, include: { shares: true } });
    assert.equal(e.accountId, ids.bMain);
    assert.equal(e.payerUserId, B);
    assert.equal(e.createdByUserId, B);
    // The household model makes it shared, split between both.
    assert.equal(e.scope, "shared");
    assert.deepEqual(e.shares.map(s => s.userId).sort(), [A, B].sort());
  });

  it("c. B unlinks: her data goes back to her scope, A's untouched", async () => {
    const spendingLinked = await countedSpending(A);
    assert.equal(spendingLinked, spendingBefore + 1200);

    assert.equal((await ok(B, "DELETE", "/api/partner/unlink")).success, true);

    // Link and membership gone.
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: B } })).linkedUserId, null);
    assert.equal(await prisma.householdMember.count({ where: { userId: B } }), 0);
    assert.equal(await prisma.householdMember.count({ where: { userId: A, role: "owner" } }), 1);

    // Her rows back in her scope.
    const bIncomes = await prisma.income.findMany({ where: { ownerUserId: B } });
    assert.ok(bIncomes.length === 1 && bIncomes.every(i => i.userId === B));
    assert.ok((await prisma.income.findMany({ where: { ownerUserId: A } })).every(i => i.userId === A));
    const card = await prisma.account.findUniqueOrThrow({ where: { id: ids.bCard } });
    assert.deepEqual([card.userId, card.householdId, card.visibility], [B, null, "household"]);
    assert.equal((await prisma.debt.findUniqueOrThrow({ where: { id: ids.bCardDebt } })).userId, B);
    assert.equal((await prisma.lifePlan.findUniqueOrThrow({ where: { id: ids.bPlan } })).userId, B);
    assert.equal(await prisma.planDeposit.count({ where: { planId: ids.bPlan, userId: B } }), 1);
    assert.equal(await prisma.allocation.count({ where: { userId: B, lifePlanId: ids.bPlan } }), 1);
    assert.equal(await prisma.allocation.count({ where: { userId: B, debtId: ids.bCardDebt } }), 1);
    for (const id of [ids.bPurchase, ids.bImported, bLinkedExpense]) {
      assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id } })).userId, B, `expense ${id} not back with B`);
    }
    // Her kept Main came back with her, with the expense she entered on it;
    // out of the household, that shared expense is now her personal one.
    const main = await prisma.account.findUniqueOrThrow({ where: { id: ids.bMain } });
    assert.deepEqual([main.userId, main.ownerUserId, main.householdId, main.visibility], [B, B, null, "household"]);
    const linked = await prisma.expense.findUniqueOrThrow({ where: { id: bLinkedExpense }, include: { shares: true } });
    assert.equal(linked.accountId, ids.bMain);
    assert.equal(linked.scope, "personal");
    assert.deepEqual(linked.shares, []);

    // externalId restored to the original (free in her scope).
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: ids.bImported } })).externalId, IMPORT_HASH);

    // She has her default lines again, one per type; A keeps exactly his.
    assert.deepEqual(await defaultLinesByType(B), { fixed: 1, flexible: 1 });
    assert.deepEqual(await defaultLinesByType(A), { fixed: 1, flexible: 1 });

    // Balances unchanged on both sides.
    assert.deepEqual(new Map([...await liveBalances(A), ...await liveBalances(B)]), balancesBefore);
    assert.deepEqual([...(await liveBalances(B)).keys()], [ids.bCardDebt]);

    // Spending: nothing lost or counted twice across the two scopes.
    assert.equal(await countedSpending(A) + await countedSpending(B), spendingLinked);

    // Baselines back to each person's own.
    const asA = await ok(A, "GET", "/api/allocations");
    assert.deepEqual([asA.monthlyIncome, asA.ownMonthlyIncome, asA.isCouple], [3230, 3230, false]);
    const asB = await ok(B, "GET", "/api/allocations");
    assert.deepEqual([asB.monthlyIncome, asB.ownMonthlyIncome, asB.isCouple], [925, 925, false]);

    // Back on her own, an expense without accountId must not land on her card
    // (that would silently turn it into card debt): it goes to her Main, and
    // none is seeded since hers came back.
    const solo = (await ok(B, "POST", "/api/expenses", { amount: 8, description: "Pan" })).expense;
    assert.equal(solo.accountId, ids.bMain);
    assert.equal(await prisma.account.count({ where: { userId: B, type: { not: "card" } } }), 1);
    const soloAccount = await prisma.account.findUniqueOrThrow({ where: { id: solo.accountId } });
    assert.deepEqual([soloAccount.userId, soloAccount.ownerUserId], [B, B]);
    assert.notEqual(soloAccount.type, "card");
    assert.equal((await liveBalances(B)).get(ids.bCardDebt), balancesBefore.get(ids.bCardDebt));

    // A second unlink, from either side, is a clean 400.
    for (const who of [B, A]) {
      const r = await call(who, "DELETE", "/api/partner/unlink");
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "No partner link found");
    }
  });

  it("d. re-accepting merges again without nesting externalId prefixes", async () => {
    const balances = new Map([...await liveBalances(A), ...await liveBalances(B)]);
    const spending = await countedSpending(A) + await countedSpending(B);

    const token = await invite(A, "bea@test.local");
    await ok(B, "POST", "/api/partner/accept", { token });

    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: ids.bImported } })).externalId, `merged:${B}:${IMPORT_HASH}`);
    assert.deepEqual(await defaultLinesByType(A), { fixed: 1, flexible: 1 });
    assert.equal(await prisma.allocation.count({ where: { userId: B } }), 0);
    assert.deepEqual(await liveBalances(A), balances);
    assert.equal(await countedSpending(A), spending);
    assert.equal((await ok(B, "GET", "/api/allocations")).monthlyIncome, 4155);

    // And once more round the loop: unlink restores, re-merge still doesn't nest.
    await ok(A, "DELETE", "/api/partner/unlink");
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: ids.bImported } })).externalId, IMPORT_HASH);
    await ok(B, "POST", "/api/partner/accept", { token: await invite(A, "bea@test.local") });
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: ids.bImported } })).externalId, `merged:${B}:${IMPORT_HASH}`);
    assert.deepEqual(await liveBalances(A), balances);
  });

  it("e. repair script: dry run writes nothing, apply merges + fixes baselines, re-run is a no-op", async () => {
    const C = await signUp("Carlos", "carlos@test.local", "es");
    const D = await signUp("Dana", "dana@test.local", "es");
    // Last closed period's paychecks, each in their own scope (D's never merged).
    const lastPeriod = periodLib.periodBounds(periodLib.periodKeyOffset(periodKey(), -1), 1).start;
    const payday = new Date(lastPeriod.getTime() + 14 * 86_400_000);
    await prisma.income.create({ data: { userId: C, ownerUserId: C, amount: 323000, date: payday } });
    await prisma.income.create({ data: { userId: D, ownerUserId: D, amount: 92500, date: payday } });
    const dExpense = (await prisma.expense.create({ data: { userId: D, amount: 3000, description: "Gym", createdByUserId: D, payerUserId: D } })).id;
    // Legacy link: set without moving anything; the old income step wrote the
    // household total into the owner's row.
    await prisma.userSettings.update({ where: { userId: C }, data: { monthlyIncome: 415500 } });
    await prisma.userSettings.update({ where: { userId: D }, data: { monthlyIncome: 92500, linkedUserId: C } });

    const before = await dbFingerprint();
    const dry = await repairPartnerData({ apply: false, setBaselines: true });
    assert.equal(await dbFingerprint(), before, "dry run wrote to the database");
    assert.equal(dry.pending, 1);       // only C/D has data to move (A/B already merged)
    assert.equal(dry.doubleCounts, 1);
    assert.equal(dry.baselinesSet, 0);

    const applied = await repairPartnerData({ apply: true, setBaselines: true });
    assert.deepEqual([applied.pending, applied.skipped, applied.baselinesSet], [1, 0, 1]);
    assert.equal((await prisma.expense.findUniqueOrThrow({ where: { id: dExpense } })).userId, C);
    assert.equal(await prisma.income.count({ where: { userId: D } }), 0);
    assert.deepEqual(await defaultLinesByType(C), { fixed: 1, flexible: 1 });
    assert.equal(await prisma.allocation.count({ where: { userId: D } }), 0);
    const members = await prisma.householdMember.findMany({ where: { userId: { in: [C, D] } } });
    assert.equal(new Set(members.map(m => m.householdId)).size, 1);
    assert.equal(members.length, 2);
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: C } })).monthlyIncome, 323000);
    assert.equal((await prisma.userSettings.findUniqueOrThrow({ where: { userId: D } })).monthlyIncome, 92500);
    assert.equal((await ok(C, "GET", "/api/allocations")).monthlyIncome, 4155);

    const settled = await dbFingerprint();
    const again = await repairPartnerData({ apply: true, setBaselines: true });
    assert.deepEqual([again.pending, again.doubleCounts, again.baselinesSet], [0, 0, 0]);
    assert.equal(await dbFingerprint(), settled, "re-run wrote to the database");
  });

  it("f. two concurrent accepts that would form a chain: exactly one wins", async () => {
    for (let round = 0; round < 5; round++) {
      const E = await signUp(`E${round}`, `e${round}@test.local`);
      const F = await signUp(`F${round}`, `f${round}@test.local`);
      const G = await signUp(`G${round}`, `g${round}@test.local`);
      const eInvitesF = await invite(E, `f${round}@test.local`);
      const fInvitesG = await invite(F, `g${round}@test.local`);
      // F joining E's pool while G joins F's would chain G → F → E.
      const results = await Promise.all([
        call(F, "POST", "/api/partner/accept", { token: eInvitesF }),
        call(G, "POST", "/api/partner/accept", { token: fInvitesG }),
      ]);
      const statuses = results.map(r => r.status).sort();
      assert.deepEqual(statuses, [200, 400], `round ${round}: ${JSON.stringify(results)}`);
      const links = await prisma.userSettings.findMany({ where: { userId: { in: [E, F, G] }, linkedUserId: { not: null } } });
      assert.equal(links.length, 1, `round ${round}: ${links.length} links`);
      const members = await prisma.householdMember.findMany({ where: { userId: { in: [E, F, G] }, role: "member" } });
      assert.equal(members.length, 1);
    }
  });
});
