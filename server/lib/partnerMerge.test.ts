// Run with:  node --import tsx --test server/lib/partnerMerge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planPoolMerge, summarizeMerge, namespacedExternalId, originalExternalId, isEmptySummary, isUntouchedDefaultAllocation, isUnusedDefaultAccount,
  type MergeInput, type MergeAllocation, type MergeAccount,
} from "./partnerMerge.js";
import { DEFAULT_ACCOUNT_NAME } from "./onboarding.js";
import { sumBaselines } from "./householdIncome.js";
import { toCents } from "./money.js";

const line = (over: Partial<MergeAllocation>): MergeAllocation => ({
  id: "x", name: "Fixed Expenses", type: "fixed", isDefault: true, allocatedAmount: 0, hasBudgetedMonth: false, ...over,
});
const account = (over: Partial<MergeAccount>): MergeAccount => ({
  id: "acc", name: DEFAULT_ACCOUNT_NAME, type: "checking", currentBalance: 0, bankConnectionId: null, isArchived: false, referenced: false, ...over,
});

// The partner right after her onboarding: seeded defaults, her own data.
const base: MergeInput = {
  memberId: "m",
  memberAllocations: [
    line({ id: "m-fixed", name: "Fixed Expenses", type: "fixed" }),
    line({ id: "m-flex", name: "Flexible Spending", type: "flexible" }),
  ],
  poolAllocations: [
    { id: "p-fixed", type: "fixed", isDefault: true },
    { id: "p-flex", type: "flexible", isDefault: true },
  ],
  memberAccounts: [account({ id: "m-main" })],
  memberExpenseExternalIds: [],
  memberIncomeExternalIds: [],
  poolExternalIds: { expense: new Set(), income: new Set() },
  memberRules: [],
  poolRuleKeys: new Set(),
  memberRecurring: [],
  poolRecurringMerchants: new Set(),
  poolMaxSortOrder: { allocation: 4, account: 1, debt: -1 },
};

test("untouched default lines merge into the pool's matching line instead of duplicating it", () => {
  const plan = planPoolMerge(base);
  assert.deepEqual([...plan.allocationRemap], [["m-fixed", "p-fixed"], ["m-flex", "p-flex"]]);
});

test("a line she configured is kept (moved), not merged", () => {
  const plan = planPoolMerge({
    ...base,
    memberAllocations: [
      line({ id: "m-fixed", allocatedAmount: 80000 }),                         // budgeted
      line({ id: "m-flex", name: "Flexible Spending", type: "flexible", hasBudgetedMonth: true }), // budgeted a month
      line({ id: "m-gym", name: "Gym", type: "fixed", isDefault: false }),    // custom, 0 €
    ],
  });
  assert.equal(plan.allocationRemap.size, 0);
});

test("an untouched default with no matching pool line is moved, not dropped", () => {
  const plan = planPoolMerge({ ...base, poolAllocations: [{ id: "p-fixed", type: "fixed", isDefault: true }] });
  assert.deepEqual([...plan.allocationRemap], [["m-fixed", "p-fixed"]]);
});

test("defaults match on type, whatever their names: older pools and cross-language couples", () => {
  // Pool seeded long ago in English; she signed up in Spanish.
  const plan = planPoolMerge({
    ...base,
    memberAllocations: [
      line({ id: "m-fixed", name: "Gastos fijos", type: "fixed" }),
      line({ id: "m-flex", name: "Gastos variables", type: "flexible" }),
    ],
  });
  assert.deepEqual([...plan.allocationRemap], [["m-fixed", "p-fixed"], ["m-flex", "p-flex"]]);
});

test("only the pool's default line of that type is a target, not a custom one", () => {
  const plan = planPoolMerge({
    ...base,
    poolAllocations: [{ id: "p-rent", type: "fixed", isDefault: false }, { id: "p-fixed", type: "fixed", isDefault: true }],
  });
  assert.equal(plan.allocationRemap.get("m-fixed"), "p-fixed");
  const noDefault = planPoolMerge({ ...base, poolAllocations: [{ id: "p-rent", type: "fixed", isDefault: false }] });
  assert.equal(noDefault.allocationRemap.size, 0);
});

test("a renamed default is hers and is moved, not merged", () => {
  const plan = planPoolMerge({ ...base, memberAllocations: [line({ id: "m-fixed", name: "Casa" })] });
  assert.equal(plan.allocationRemap.size, 0);
});

test("isUntouchedDefaultAllocation", () => {
  assert.equal(isUntouchedDefaultAllocation(line({})), true);
  assert.equal(isUntouchedDefaultAllocation(line({ allocatedAmount: 1 })), false);
  assert.equal(isUntouchedDefaultAllocation(line({ hasBudgetedMonth: true })), false);
  assert.equal(isUntouchedDefaultAllocation(line({ isDefault: false })), false);
  assert.equal(isUntouchedDefaultAllocation(line({ name: "Gastos variables" })), true);
  assert.equal(isUntouchedDefaultAllocation(line({ name: "Casa" })), false);
});

test("her seeded Main account is dropped only while unused; every other account moves", () => {
  const plan = planPoolMerge({
    ...base,
    memberAccounts: [
      account({ id: "unused" }),
      account({ id: "used", referenced: true }),
      account({ id: "funded", currentBalance: 150000 }),
      account({ id: "renamed", name: "BBVA" }),
      account({ id: "card", type: "card", name: "Carrefour PASS" }),
      account({ id: "linked", bankConnectionId: "bc1" }),
    ],
  });
  assert.deepEqual(plan.deleteAccountIds, ["unused"]);
  assert.equal(isUnusedDefaultAccount(account({ referenced: true })), false);
});

// Her own open non-card account is what her expenses default to while linked
// (defaultAccount.ts); without one they'd go to her partner's account.
test("her unused Main is kept when it would be her only open non-card account", () => {
  const keep = (memberAccounts: MergeAccount[]) => planPoolMerge({ ...base, memberAccounts }).deleteAccountIds;
  // Only a card besides Main → Main kept.
  assert.deepEqual(keep([account({ id: "main" }), account({ id: "card", type: "card", name: "Visa" })]), []);
  // No other account → kept.
  assert.deepEqual(keep([account({ id: "main" })]), []);
  // An archived checking doesn't count → kept.
  assert.deepEqual(keep([account({ id: "main" }), account({ id: "old", name: "BBVA", isArchived: true })]), []);
  // Another open checking account of hers → Main deleted.
  assert.deepEqual(keep([account({ id: "main" }), account({ id: "bbva", name: "BBVA" })]), ["main"]);
  // Two unused Mains and nothing else: one is kept.
  assert.deepEqual(keep([account({ id: "main1" }), account({ id: "main2" })]), ["main2"]);
});

test("transactions whose externalId the pool has are kept under a namespaced id; duplicate rules/recurring drop", () => {
  const plan = planPoolMerge({
    ...base,
    memberExpenseExternalIds: [{ id: "e1", externalId: "dup" }, { id: "e2", externalId: "new" }],
    memberIncomeExternalIds: [{ id: "i1", externalId: "dup-inc" }, { id: "i2", externalId: "only-mine" }],
    poolExternalIds: { expense: new Set(["dup"]), income: new Set(["dup-inc"]) },
    memberRules: [{ id: "r1", matchType: "contains", pattern: "mercadona" }, { id: "r2", matchType: "contains", pattern: "lidl" }],
    poolRuleKeys: new Set(["contains|mercadona", "equals|lidl"]),
    memberRecurring: [{ id: "c1", merchant: "netflix" }, { id: "c2", merchant: "gym" }],
    poolRecurringMerchants: new Set(["netflix"]),
  });
  assert.deepEqual(plan.renameExpenseExternalIds, [{ id: "e1", externalId: "merged:m:dup" }]);
  assert.deepEqual(plan.renameIncomeExternalIds, [{ id: "i1", externalId: "merged:m:dup-inc" }]);
  assert.deepEqual(plan.dropRuleIds, ["r1"]);
  assert.deepEqual(plan.dropRecurringIds, ["c1"]);
});

test("a namespaced id never collides with one the pool or she already has", () => {
  const plan = planPoolMerge({
    ...base,
    memberExpenseExternalIds: [{ id: "e1", externalId: "x" }, { id: "e2", externalId: "merged:m:x" }],
    poolExternalIds: { expense: new Set(["x", "merged:m#2:x"]), income: new Set() },
  });
  assert.deepEqual(plan.renameExpenseExternalIds, [{ id: "e1", externalId: "merged:m#3:x" }]);
  assert.equal(namespacedExternalId("m", "y", new Set()), "merged:m:y");
});

test("re-merging never nests prefixes: a namespaced id is rebuilt from its original", () => {
  // Left namespaced by an earlier link (its original was taken in her scope at
  // unlink), and the pool has that same namespaced id again.
  const plan = planPoolMerge({
    ...base,
    memberExpenseExternalIds: [{ id: "e1", externalId: "merged:m:x" }],
    poolExternalIds: { expense: new Set(["merged:m:x"]), income: new Set() },
  });
  assert.deepEqual(plan.renameExpenseExternalIds, [{ id: "e1", externalId: "merged:m#2:x" }]);
  assert.equal(namespacedExternalId("m", "merged:other#4:gocardless:t1", new Set()), "merged:m:gocardless:t1");
});

test("originalExternalId strips every merge prefix, and a legacy :n suffix only off an import hash", () => {
  const hash = "0123456789abcdef0123456789abcdef";
  assert.equal(originalExternalId(hash), hash);
  assert.equal(originalExternalId(`merged:m:${hash}`), hash);
  assert.equal(originalExternalId(`merged:m#3:${hash}`), hash);
  assert.equal(originalExternalId(`merged:m:merged:p:${hash}`), hash);
  assert.equal(originalExternalId(`merged:m:${hash}:2`), hash); // legacy suffix
  // A provider id may end in :digits; never cut it.
  assert.equal(originalExternalId("merged:m:tink:abc:2"), "tink:abc:2");
  assert.equal(originalExternalId("tink:abc:2"), "tink:abc:2");
});

test("her rows are ordered after the pool's", () => {
  assert.deepEqual(planPoolMerge(base).sortOffset, { allocation: 5, account: 2, debt: 0 });
});

test("summary counts what moves; nothing left means nothing to do (idempotent re-run)", () => {
  const plan = planPoolMerge(base);
  const counts = { incomes: 1, expenses: 3, accounts: 1, debts: 2, debtAdjustments: 0, bankConnections: 0, allocations: 2, monthlyBudgets: 0, lifePlans: 0, planDeposits: 0, rules: 0, recurring: 0 };
  const s = summarizeMerge(counts, plan);
  assert.equal(s.incomes, 1);
  assert.equal(s.accounts, 1); // her only Main is kept
  assert.equal(s.defaultAccountsDropped, 0);
  assert.equal(s.allocations, 0);
  assert.equal(s.allocationsMerged, 2);
  assert.equal(s.debts, 2);
  assert.equal(s.expenses, 3);
  assert.equal(s.externalIdsRenamed, 0);
  assert.equal(isEmptySummary(s), false);

  const empty = { ...base, memberAllocations: [], memberAccounts: [] };
  const zero = { incomes: 0, expenses: 0, accounts: 0, debts: 0, debtAdjustments: 0, bankConnections: 0, allocations: 0, monthlyBudgets: 0, lifePlans: 0, planDeposits: 0, rules: 0, recurring: 0 };
  assert.equal(isEmptySummary(summarizeMerge(zero, planPoolMerge(empty))), true);
});

// ── Household baseline income ──────────────────────────────────────────────

test("household baseline sums both partners: 3230 € + 925 € = 4155 €", () => {
  assert.equal(sumBaselines([toCents(3230), toCents(925)]), toCents(4155));
  assert.equal(sumBaselines([323000, 92500]), 415500);
});

test("a single user's baseline is just theirs; nobody configured is 0", () => {
  assert.equal(sumBaselines([323000]), 323000);
  assert.equal(sumBaselines([]), 0);
});
