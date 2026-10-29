// Run with:  node --import tsx --test server/lib/partnerUnlink.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planUnlink, type UnlinkInput } from "./partnerUnlink.js";

const HER = "her";
const EX = "ex";

type Expense = UnlinkInput["expenses"][number];
const expense = (over: Partial<Expense> & { id: string }): Expense => ({
  accountId: null, debtId: null, allocationId: null, payerUserId: HER, scope: "personal", hasShares: false, ...over,
});

// A linked couple: each has a checking account and a card (with its card debt),
// she has a loan; the pool has the two default lines, a plan line and a debt
// line per debt.
const base: UnlinkInput = {
  memberId: HER,
  accounts: [
    { id: "her-checking", ownerUserId: HER, bankConnectionId: "her-bank" },
    { id: "her-card", ownerUserId: HER, bankConnectionId: null },
    { id: "ex-checking", ownerUserId: EX, bankConnectionId: "ex-bank" },
    { id: "ex-card", ownerUserId: EX, bankConnectionId: null },
  ],
  debts: [
    { id: "her-card-debt", ownerUserId: HER, accountId: "her-card", bankConnectionId: null },
    { id: "her-loan", ownerUserId: HER, accountId: null, bankConnectionId: null },
    { id: "ex-card-debt", ownerUserId: EX, accountId: "ex-card", bankConnectionId: null },
  ],
  bankConnections: [{ id: "her-bank", ownerUserId: HER }, { id: "ex-bank", ownerUserId: EX }],
  incomes: [
    { id: "her-salary", ownerUserId: HER, accountId: "her-checking" },
    { id: "ex-salary", ownerUserId: EX, accountId: "ex-checking" },
  ],
  expenses: [],
  allocations: [
    { id: "fixed", type: "fixed", debtId: null },
    { id: "flex", type: "flexible", debtId: null },
    { id: "plan", type: "plan", debtId: null },
    { id: "line-her-loan", type: "debt", debtId: "her-loan" },
    { id: "line-ex-card", type: "debt", debtId: "ex-card-debt" },
  ],
  rules: [{ id: "r-her-loan", allocationId: "line-her-loan" }, { id: "r-fixed", allocationId: "fixed" }],
  recurring: [{ id: "c-her-loan", allocationId: "line-her-loan" }, { id: "c-fixed", allocationId: "fixed" }],
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
    accounts: [...base.accounts, { id: "her-on-ex-bank", ownerUserId: HER, bankConnectionId: "ex-bank" }],
    debts: [...base.debts, { id: "her-loan-on-ex-bank", ownerUserId: HER, accountId: null, bankConnectionId: "ex-bank" }],
    incomes: [...base.incomes, { id: "ex-paid-into-hers", ownerUserId: EX, accountId: "her-checking" }],
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
    allocations: [...base.allocations, { id: "line-her-loan-on-ex-card", type: "debt", debtId: "her-loan-on-ex-card" }],
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

test("a member with nothing of her own moves nothing", () => {
  const plan = planUnlink({ ...base, memberId: "someone-else" });
  for (const ids of Object.values(plan.move)) assert.deepEqual(ids, []);
  assert.equal(plan.copyAllocations.size, 0);
});
