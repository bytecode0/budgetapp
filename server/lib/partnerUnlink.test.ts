// Run with:  node --import tsx --test server/lib/partnerUnlink.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planUnlink, planRestoreExternalIds, planClashRenames, type UnlinkInput } from "./partnerUnlink.js";

const HER = "her";
const EX = "ex";

type Expense = UnlinkInput["expenses"][number];
const expense = (over: Partial<Expense> & { id: string }): Expense => ({
  accountId: null, externalId: null, debtId: null, allocationId: null, payerUserId: HER, createdByUserId: null, scope: "personal", hasShares: false, ...over,
});

// A linked couple: each has a checking account and a card (with its card debt),
// she has a loan; the pool has the two default lines, a plan line and a debt
// line per debt.
const base: UnlinkInput = {
  memberId: HER,
  accounts: [
    { id: "her-checking", ownerUserId: HER, bankConnectionId: "her-bank", type: "checking", isArchived: false },
    { id: "her-card", ownerUserId: HER, bankConnectionId: null, type: "card", isArchived: false },
    { id: "ex-checking", ownerUserId: EX, bankConnectionId: "ex-bank", type: "checking", isArchived: false },
    { id: "ex-card", ownerUserId: EX, bankConnectionId: null, type: "card", isArchived: false },
  ],
  debts: [
    { id: "her-card-debt", ownerUserId: HER, accountId: "her-card", bankConnectionId: null },
    { id: "her-loan", ownerUserId: HER, accountId: null, bankConnectionId: null },
    { id: "ex-card-debt", ownerUserId: EX, accountId: "ex-card", bankConnectionId: null },
  ],
  bankConnections: [{ id: "her-bank", ownerUserId: HER }, { id: "ex-bank", ownerUserId: EX }],
  incomes: [
    { id: "her-salary", ownerUserId: HER, accountId: "her-checking", externalId: null },
    { id: "ex-salary", ownerUserId: EX, accountId: "ex-checking", externalId: null },
  ],
  expenses: [],
  plans: [],
  allocations: [
    { id: "fixed", type: "fixed", isDefault: true, debtId: null, lifePlanId: null },
    { id: "flex", type: "flexible", isDefault: true, debtId: null, lifePlanId: null },
    { id: "plan", type: "plan", isDefault: false, debtId: null, lifePlanId: null },
    { id: "line-her-loan", type: "debt", isDefault: false, debtId: "her-loan", lifePlanId: null },
    { id: "line-ex-card", type: "debt", isDefault: false, debtId: "ex-card-debt", lifePlanId: null },
  ],
  rules: [
    { id: "r-her-loan", allocationId: "line-her-loan", matchType: "contains", pattern: "cofidis" },
    { id: "r-fixed", allocationId: "fixed", matchType: "contains", pattern: "rent" },
  ],
  recurring: [{ id: "c-her-loan", allocationId: "line-her-loan" }, { id: "c-fixed", allocationId: "fixed" }],
  poolId: EX,
  memberAllocations: [],
  memberAccounts: [],
  memberExternalIds: { expense: new Set(), income: new Set() },
  memberRuleKeys: new Set(),
};

test("what she owns moves back; what the ex owns stays", () => {
  const { move } = planUnlink(base);
  assert.deepEqual(move.accountIds, ["her-checking", "her-card"]);
  assert.deepEqual(move.debtIds, ["her-card-debt", "her-loan"]);
  assert.deepEqual(move.bankConnectionIds, ["her-bank"]);
  assert.deepEqual(move.incomeIds, ["her-salary"]);
});

test("the debt lines of her debts move with the rules on them; the pool's lines stay", () => {
  const plan = planUnlink(base);
  assert.deepEqual(plan.move.allocationIds, ["line-her-loan"]);
  assert.deepEqual(plan.move.ruleIds, ["r-her-loan"]);
  // A recurring commitment of the pool can't point into her scope.
  assert.deepEqual(plan.clear.recurringAllocation, ["c-her-loan"]);
});

test("expenses follow what they're attached to, so no debt balance changes on either side", () => {
  const plan = planUnlink({
    ...base,
    expenses: [
      expense({ id: "pay-her-loan", debtId: "her-loan", accountId: "ex-checking", payerUserId: EX }), // ex paid her loan
      expense({ id: "pay-ex-card", debtId: "ex-card-debt", accountId: "her-checking" }),               // she paid ex's card
      expense({ id: "her-card-buy", accountId: "her-card" }),
      expense({ id: "her-card-shared", accountId: "her-card", scope: "shared", hasShares: true }),
      expense({ id: "ex-card-buy-by-her", accountId: "ex-card" }),                                      // on ex's card
      expense({ id: "her-cash", payerUserId: HER }),
      expense({ id: "her-cash-shared", payerUserId: HER, scope: "shared", hasShares: true }),
      expense({ id: "her-cash-shared-unsplit", payerUserId: HER, scope: "shared", hasShares: false }),
      expense({ id: "ex-cash", payerUserId: EX }),
    ],
  });
  assert.deepEqual(plan.move.expenseIds.sort(), [
    "her-card-buy", "her-card-shared", "her-cash", "her-cash-shared-unsplit", "pay-her-loan",
  ]);
  // Cross-scope account links are cleared: the ex's account on a payment that
  // moves, her account on a payment that stays.
  assert.deepEqual(plan.clear.expenseAccount.sort(), ["pay-ex-card", "pay-her-loan"]);
});

test("what she entered while linked comes back, unless it would change a debt balance", () => {
  const plan = planUnlink({
    ...base,
    expenses: [
      // On the ex's checking (the old default account): hers, account cleared.
      expense({ id: "groceries-on-ex-main", accountId: "ex-checking", payerUserId: EX, createdByUserId: HER }),
      // A purchase on the ex's card feeds the ex's card debt: stays.
      expense({ id: "buy-on-ex-card", accountId: "ex-card", payerUserId: EX, createdByUserId: HER }),
      // A payment of the ex's debt: stays with the debt.
      expense({ id: "pays-ex-card", debtId: "ex-card-debt", accountId: "ex-checking", payerUserId: EX, createdByUserId: HER }),
      // No account, shared and split, but she entered it: hers.
      expense({ id: "shared-dinner", payerUserId: EX, createdByUserId: HER, scope: "shared", hasShares: true }),
      // The ex entered one on her card: it follows her card.
      expense({ id: "ex-on-her-card", accountId: "her-card", payerUserId: HER, createdByUserId: EX }),
      // The ex entered one with no account he paid: stays.
      expense({ id: "ex-cash", payerUserId: EX, createdByUserId: EX }),
    ],
  });
  assert.deepEqual(plan.move.expenseIds.sort(), ["ex-on-her-card", "groceries-on-ex-main", "shared-dinner"]);
  assert.deepEqual(plan.clear.expenseAccount, ["groceries-on-ex-main"]);
});

test("a moved shared expense becomes her personal one; what stays in the pool is untouched", () => {
  const plan = planUnlink({
    ...base,
    expenses: [
      expense({ id: "shared-on-her-checking", accountId: "her-checking", scope: "shared", hasShares: true }),
      expense({ id: "shared-dinner-she-entered", payerUserId: EX, createdByUserId: HER, scope: "shared", hasShares: true }),
      expense({ id: "shared-unsplit", scope: "shared", hasShares: false }),
      expense({ id: "her-personal", accountId: "her-checking" }),
      expense({ id: "ex-shared", accountId: "ex-checking", payerUserId: EX, createdByUserId: EX, scope: "shared", hasShares: true }),
    ],
  });
  assert.deepEqual(plan.personalExpenseIds.sort(), ["shared-dinner-she-entered", "shared-on-her-checking", "shared-unsplit"]);
});

test("her moved expenses keep their category via a copied line; plan and other debt lines don't copy", () => {
  const plan = planUnlink({
    ...base,
    expenses: [
      expense({ id: "groceries", accountId: "her-card", allocationId: "flex" }),
      expense({ id: "rent", allocationId: "fixed" }),
      expense({ id: "more-groceries", allocationId: "flex" }),
      expense({ id: "saving", allocationId: "plan" }),
      expense({ id: "into-ex-line", allocationId: "line-ex-card" }),
      expense({ id: "loan-pay", debtId: "her-loan", allocationId: "line-her-loan" }),     // line moves with her
      expense({ id: "ex-in-her-line", payerUserId: EX, allocationId: "line-her-loan" }), // stays, line leaves
      expense({ id: "ex-groceries", payerUserId: EX, allocationId: "flex" }),
    ],
  });
  assert.deepEqual([...plan.copyAllocations], [["flex", ["groceries", "more-groceries"]], ["fixed", ["rent"]]]);
  assert.deepEqual(plan.clear.expenseAllocation.sort(), ["ex-in-her-line", "into-ex-line", "saving"]);
});

test("incomes and accounts never keep a reference across the two scopes", () => {
  const plan = planUnlink({
    ...base,
    accounts: [...base.accounts, { id: "her-on-ex-bank", ownerUserId: HER, bankConnectionId: "ex-bank", type: "checking", isArchived: false }],
    debts: [...base.debts, { id: "her-loan-on-ex-bank", ownerUserId: HER, accountId: null, bankConnectionId: "ex-bank" }],
    incomes: [...base.incomes, { id: "ex-paid-into-hers", ownerUserId: EX, accountId: "her-checking", externalId: null }],
  });
  assert.deepEqual(plan.clear.incomeAccount, ["ex-paid-into-hers"]);
  assert.deepEqual(plan.clear.debtBankConnection, ["her-loan-on-ex-bank"]);
  assert.deepEqual(plan.clear.accountBankConnection, ["her-on-ex-bank"]);
});

// A debt linked to an account of the other owner (only possible before the
// same-owner rule): its balance reads the account's purchases, so the pair
// stays together in the pool and no balance changes on either side.
test("the ex's debt on her account keeps her account in the pool, with its purchases", () => {
  const plan = planUnlink({
    ...base,
    debts: [...base.debts, { id: "ex-loan-on-her-checking", ownerUserId: EX, accountId: "her-checking", bankConnectionId: null }],
    expenses: [
      expense({ id: "buy-on-her-checking", accountId: "her-checking" }),
      expense({ id: "pay-ex-loan", debtId: "ex-loan-on-her-checking", accountId: "her-card" }),
    ],
  });
  assert.deepEqual(plan.move.accountIds, ["her-card"]);
  assert.ok(!plan.move.expenseIds.includes("buy-on-her-checking"));
  // Her bank connection still moves; the account staying behind loses it.
  assert.deepEqual(plan.clear.accountBankConnection, ["her-checking"]);
});

test("her debt on the ex's account stays in the pool with it, payments and all", () => {
  const plan = planUnlink({
    ...base,
    debts: [...base.debts, { id: "her-loan-on-ex-card", ownerUserId: HER, accountId: "ex-card", bankConnectionId: null }],
    allocations: [...base.allocations, { id: "line-her-loan-on-ex-card", type: "debt", isDefault: false, debtId: "her-loan-on-ex-card", lifePlanId: null }],
    expenses: [
      expense({ id: "pay-it", debtId: "her-loan-on-ex-card", accountId: "her-checking" }),
      expense({ id: "ex-card-buy", accountId: "ex-card", payerUserId: EX }),
    ],
  });
  assert.ok(!plan.move.debtIds.includes("her-loan-on-ex-card"));
  assert.ok(!plan.move.allocationIds.includes("line-her-loan-on-ex-card"));
  assert.ok(!plan.move.expenseIds.includes("pay-it"));
});

test("a pair kept in the pool also keeps her other debt on that account", () => {
  // The ex's loan holds her checking in the pool; her own loan on that same
  // account must then stay too, or its purchases would be left behind.
  const plan = planUnlink({
    ...base,
    debts: [
      ...base.debts,
      { id: "ex-loan", ownerUserId: EX, accountId: "her-checking", bankConnectionId: null },
      { id: "her-loan-on-checking", ownerUserId: HER, accountId: "her-checking", bankConnectionId: null },
    ],
  });
  assert.ok(!plan.move.accountIds.includes("her-checking"));
  assert.ok(!plan.move.debtIds.includes("her-loan-on-checking"));
  assert.ok(plan.move.debtIds.includes("her-card-debt"));
});

test("after the move no debt is linked to an account in the other scope", () => {
  const input: UnlinkInput = {
    ...base,
    debts: [
      ...base.debts,
      { id: "ex-loan", ownerUserId: EX, accountId: "her-checking", bankConnectionId: null },
      { id: "her-loan2", ownerUserId: HER, accountId: "ex-checking", bankConnectionId: null },
    ],
  };
  const plan = planUnlink(input);
  const debtMoves = new Set(plan.move.debtIds);
  const accountMoves = new Set(plan.move.accountIds);
  for (const d of input.debts) {
    if (d.accountId) assert.equal(debtMoves.has(d.id), accountMoves.has(d.accountId), d.id);
  }
});

test("her plans come back with their plan lines and the rules on them; unowned and the ex's plans stay", () => {
  const plan = planUnlink({
    ...base,
    plans: [
      { id: "her-trip", ownerUserId: HER },
      { id: "ex-car", ownerUserId: EX },
      { id: "old-pool-plan", ownerUserId: null },
    ],
    allocations: [
      ...base.allocations,
      { id: "line-her-trip", type: "plan", isDefault: false, debtId: null, lifePlanId: "her-trip" },
      { id: "line-ex-car", type: "plan", isDefault: false, debtId: null, lifePlanId: "ex-car" },
    ],
    rules: [...base.rules, { id: "r-trip", allocationId: "line-her-trip", matchType: "contains", pattern: "ryanair" }],
    expenses: [
      expense({ id: "her-saving", allocationId: "line-her-trip", createdByUserId: HER }),
      expense({ id: "ex-saving-for-her-trip", allocationId: "line-her-trip", payerUserId: EX, createdByUserId: EX }),
    ],
  });
  assert.deepEqual(plan.move.planIds, ["her-trip"]);
  assert.ok(plan.move.allocationIds.includes("line-her-trip"));
  assert.ok(!plan.move.allocationIds.includes("line-ex-car"));
  assert.ok(plan.move.ruleIds.includes("r-trip"));
  // Her contribution keeps its line; the ex's loses it (the line leaves).
  assert.ok(!plan.clear.expenseAllocation.includes("her-saving"));
  assert.ok(plan.clear.expenseAllocation.includes("ex-saving-for-her-trip"));
});

test("moved rows get back the externalId merge namespaced, when it is free in her scope", () => {
  const plan = planUnlink({
    ...base,
    incomes: [...base.incomes, { id: "her-bonus", ownerUserId: HER, accountId: null, externalId: "merged:her:inc1" }],
    expenses: [
      expense({ id: "renamed", accountId: "her-checking", externalId: "merged:her:abc" }),
      expense({ id: "renamed-twice", accountId: "her-checking", externalId: "merged:her#2:def" }),
      expense({ id: "taken-in-her-scope", accountId: "her-checking", externalId: "merged:her:ghi" }),
      expense({ id: "plain", accountId: "her-checking", externalId: "jkl" }),
      expense({ id: "stays", accountId: "ex-checking", payerUserId: EX, externalId: "merged:her:mno" }),
    ],
    memberExternalIds: { expense: new Set(["ghi"]), income: new Set() },
  });
  assert.deepEqual(plan.restoreExternalIds.expense, [
    { id: "renamed", externalId: "abc" },
    { id: "renamed-twice", externalId: "def" },
  ]);
  assert.deepEqual(plan.restoreExternalIds.income, [{ id: "her-bonus", externalId: "inc1" }]);
});

test("two moved rows with the same original: only the first gets it back", () => {
  const out = planRestoreExternalIds([
    { id: "a", externalId: "merged:her:x" },
    { id: "b", externalId: "merged:her#2:x" },
    { id: "c", externalId: "x2" },
  ], new Set());
  assert.deepEqual(out, [{ id: "a", externalId: "x" }]);
});

// Rows already under her own userId (e.g. bank sync into her scope while
// linked) must not make the unlink fail on a unique key.
test("a moved row whose externalId she already has is namespaced before the move, never dropped", () => {
  const plan = planUnlink({
    ...base,
    incomes: [...base.incomes, { id: "her-bonus", ownerUserId: HER, accountId: null, externalId: "inc1" }],
    expenses: [
      expense({ id: "clash", accountId: "her-checking", externalId: "abc" }),
      expense({ id: "free", accountId: "her-checking", externalId: "def" }),
      expense({ id: "ex-row", accountId: "ex-checking", payerUserId: EX, externalId: "merged:ex:abc" }),
    ],
    memberExternalIds: { expense: new Set(["abc"]), income: new Set(["inc1"]) },
  });
  // `merged:ex:abc` is taken in the pool, so the counter goes up.
  assert.deepEqual(plan.clashExternalIds.expense, [{ id: "clash", externalId: "merged:ex#2:abc" }]);
  assert.deepEqual(plan.clashExternalIds.income, [{ id: "her-bonus", externalId: "merged:ex:inc1" }]);
  assert.ok(plan.move.expenseIds.includes("clash"));
  // Its original is hers already, so it is not restored either.
  assert.deepEqual(plan.restoreExternalIds.expense, []);
});

test("a clashing row that merge had namespaced gets its original back when that is free", () => {
  const out = planClashRenames([{ id: "a", externalId: "merged:her:x" }], new Set(["merged:her:x"]), new Set(), "ex");
  assert.deepEqual(out, [{ id: "a", externalId: "merged:ex:x" }]);
  const plan = planUnlink({
    ...base,
    expenses: [expense({ id: "a", accountId: "her-checking", externalId: "merged:her:x" })],
    memberExternalIds: { expense: new Set(["merged:her:x"]), income: new Set() },
  });
  assert.deepEqual(plan.restoreExternalIds.expense, [{ id: "a", externalId: "x" }]);
});

test("a moving rule she already has is dropped in favour of hers", () => {
  const plan = planUnlink({ ...base, memberRuleKeys: new Set(["contains|cofidis"]) });
  assert.deepEqual(plan.dropRuleIds, ["r-her-loan"]);
  assert.deepEqual(plan.move.ruleIds, []);
});

test("she ends with a default line of each seeded type: the copy of the pool's default, else a fresh one", () => {
  // Her groceries use the pool's default flexible line: its copy becomes her
  // default. Nothing of hers uses a fixed line: one is seeded.
  const plan = planUnlink({ ...base, expenses: [expense({ id: "groceries", allocationId: "flex" })] });
  assert.deepEqual([...plan.copyAsDefault], ["flex"]);
  assert.deepEqual(plan.seedDefaultTypes, ["fixed"]);
});

test("a copied line that isn't the pool's default never becomes hers; defaults she has are kept", () => {
  const plan = planUnlink({
    ...base,
    allocations: [...base.allocations, { id: "gym", type: "flexible", isDefault: false, debtId: null, lifePlanId: null }],
    memberAllocations: [{ type: "fixed", isDefault: true }],
    expenses: [expense({ id: "gym-fee", allocationId: "gym" })],
  });
  assert.deepEqual([...plan.copyAsDefault], []);
  assert.deepEqual(plan.seedDefaultTypes, ["flexible"]);
});

test("a member with nothing of her own moves nothing", () => {
  const plan = planUnlink({ ...base, memberId: "someone-else" });
  for (const ids of Object.values(plan.move)) assert.deepEqual(ids, []);
  assert.equal(plan.copyAllocations.size, 0);
});

test("she keeps a non-card account: seeded only when none moves back and she has none", () => {
  assert.equal(planUnlink(base).seedDefaultAccount, false); // her checking moves back
  const cardOnly = { ...base, accounts: base.accounts.filter(a => a.id !== "her-checking") };
  assert.equal(planUnlink(cardOnly).seedDefaultAccount, true);
  const archived = { ...base, accounts: base.accounts.map(a => (a.id === "her-checking" ? { ...a, isArchived: true } : a)) };
  assert.equal(planUnlink(archived).seedDefaultAccount, true);
  assert.equal(planUnlink({ ...cardOnly, memberAccounts: [{ type: "cash", isArchived: false }] }).seedDefaultAccount, false);
});
