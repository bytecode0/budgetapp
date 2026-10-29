// Moving an invited partner's own data into the inviter's pool.
//
// Data is scoped by `userId` = the pool (the primary user of a couple; see
// requireAuth). When a partner accepts an invite, her `req.userId` switches to
// the inviter's pool, so anything she created under her own userId before
// accepting (the onboarding, typically) would become invisible. On accept —
// and for couples already linked, via server/scripts/repairPartnerData.ts — we
// move it into the pool in the same transaction as the link, keeping her as
// the owner.
//
// Model by model (prisma/schema.prisma):
//   UserSettings, Subscription, PartnerInvite, OtpToken, User,
//   Household/HouseholdMember, ExpenseShare   → not moved (per person, or not
//                                                scoped by the pool userId)
//   Income            → moved; ownerUserId stays hers
//   Account, Debt,
//   BankConnection    → moved; visibility "private", owned by her, household set
//   DebtAdjustment    → moved (follows its debt)
//   Expense           → moved; a legacy row without payer gets her as payer
//   LifePlan,
//   PlanDeposit       → moved (ids unchanged, so plan links hold)
//   Allocation        → her untouched defaults merge into the pool's matching
//                       line; everything else is moved
//   MonthlyBudget     → moved (those of a merged default are dropped with it)
//   CategorizationRule, RecurringCommitment → moved, pointing at the merged
//                       line; on a unique clash with the pool, the pool's wins
//   Expense/Income with an externalId the pool already has → dropped: the id is
//                       the same imported transaction, already in the pool
//
// planPoolMerge() holds every decision as a pure function (unit-tested);
// loadMergeInput() and applyPoolMerge() are the database around it.
import type { Prisma } from "@prisma/client";
import { DEFAULT_ACCOUNT_NAME } from "./onboarding.js";

type Db = Prisma.TransactionClient;

export interface MergeAllocation {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  allocatedAmount: number; // cents
  hasBudgetedMonth: boolean; // any MonthlyBudget with a non-zero amount
}

export interface MergeAccount {
  id: string;
  name: string;
  type: string;
  currentBalance: number; // cents
  bankConnectionId: string | null;
  referenced: boolean; // any expense, income or debt points at it
}

export interface MergeInput {
  memberAllocations: MergeAllocation[];
  poolAllocations: { id: string; name: string; type: string }[];
  memberAccounts: MergeAccount[];
  memberExpenseExternalIds: { id: string; externalId: string }[];
  memberIncomeExternalIds: { id: string; externalId: string }[];
  poolExternalIds: { expense: Set<string>; income: Set<string> };
  memberRules: { id: string; matchType: string; pattern: string }[];
  poolRuleKeys: Set<string>; // `${matchType}|${pattern}`
  memberRecurring: { id: string; merchant: string }[];
  poolRecurringMerchants: Set<string>;
  poolMaxSortOrder: { allocation: number; account: number; debt: number }; // -1 when none
}

export interface MergePlan {
  /** Her untouched default line → the pool line it merges into (hers is deleted). */
  allocationRemap: Map<string, string>;
  /** Her seeded "Main account", never used: deleted instead of cluttering the pool. */
  deleteAccountIds: string[];
  dropExpenseIds: string[];
  dropIncomeIds: string[];
  dropRuleIds: string[];
  dropRecurringIds: string[];
  /** Added to her sortOrders so her rows list after the pool's. */
  sortOffset: { allocation: number; account: number; debt: number };
}

/** A default budget line exactly as signup seeded it: nothing budgeted, ever. */
export function isUntouchedDefaultAllocation(a: MergeAllocation): boolean {
  return a.isDefault && a.allocatedAmount === 0 && !a.hasBudgetedMonth;
}

/** The seeded checking account, never renamed, funded, linked or used. */
export function isUnusedDefaultAccount(a: MergeAccount): boolean {
  return a.type === "checking"
    && a.name === DEFAULT_ACCOUNT_NAME
    && a.currentBalance === 0
    && a.bankConnectionId === null
    && !a.referenced;
}

export function planPoolMerge(input: MergeInput): MergePlan {
  const poolLine = new Map(input.poolAllocations.map(a => [`${a.type}|${a.name}`, a.id]));
  const allocationRemap = new Map<string, string>();
  for (const a of input.memberAllocations) {
    const target = poolLine.get(`${a.type}|${a.name}`);
    if (target && isUntouchedDefaultAllocation(a)) allocationRemap.set(a.id, target);
  }

  return {
    allocationRemap,
    deleteAccountIds: input.memberAccounts.filter(isUnusedDefaultAccount).map(a => a.id),
    dropExpenseIds: input.memberExpenseExternalIds
      .filter(e => input.poolExternalIds.expense.has(e.externalId)).map(e => e.id),
    dropIncomeIds: input.memberIncomeExternalIds
      .filter(i => input.poolExternalIds.income.has(i.externalId)).map(i => i.id),
    dropRuleIds: input.memberRules
      .filter(r => input.poolRuleKeys.has(`${r.matchType}|${r.pattern}`)).map(r => r.id),
    dropRecurringIds: input.memberRecurring
      .filter(r => input.poolRecurringMerchants.has(r.merchant)).map(r => r.id),
    sortOffset: {
      allocation: input.poolMaxSortOrder.allocation + 1,
      account: input.poolMaxSortOrder.account + 1,
      debt: input.poolMaxSortOrder.debt + 1,
    },
  };
}

export async function loadMergeInput(db: Db, memberId: string, poolId: string): Promise<MergeInput> {
  const [
    memberAllocations, poolAllocations, budgetedLines,
    memberAccounts, usedByExpense, usedByIncome, usedByDebt,
    memberExpenses, memberIncomes, poolExpenses, poolIncomes,
    memberRules, poolRules, memberRecurring, poolRecurring,
    maxAllocation, maxAccount, maxDebt,
  ] = await Promise.all([
    db.allocation.findMany({ where: { userId: memberId }, select: { id: true, name: true, type: true, isDefault: true, allocatedAmount: true } }),
    db.allocation.findMany({ where: { userId: poolId }, select: { id: true, name: true, type: true } }),
    db.monthlyBudget.findMany({ where: { userId: memberId, allocatedAmount: { not: 0 } }, select: { allocationId: true }, distinct: ["allocationId"] }),
    db.account.findMany({ where: { userId: memberId }, select: { id: true, name: true, type: true, currentBalance: true, bankConnectionId: true } }),
    db.expense.findMany({ where: { userId: memberId, accountId: { not: null } }, select: { accountId: true }, distinct: ["accountId"] }),
    db.income.findMany({ where: { userId: memberId, accountId: { not: null } }, select: { accountId: true }, distinct: ["accountId"] }),
    db.debt.findMany({ where: { userId: memberId, accountId: { not: null } }, select: { accountId: true }, distinct: ["accountId"] }),
    db.expense.findMany({ where: { userId: memberId, externalId: { not: null } }, select: { id: true, externalId: true } }),
    db.income.findMany({ where: { userId: memberId, externalId: { not: null } }, select: { id: true, externalId: true } }),
    db.expense.findMany({ where: { userId: poolId, externalId: { not: null } }, select: { externalId: true } }),
    db.income.findMany({ where: { userId: poolId, externalId: { not: null } }, select: { externalId: true } }),
    db.categorizationRule.findMany({ where: { userId: memberId }, select: { id: true, matchType: true, pattern: true } }),
    db.categorizationRule.findMany({ where: { userId: poolId }, select: { matchType: true, pattern: true } }),
    db.recurringCommitment.findMany({ where: { userId: memberId }, select: { id: true, merchant: true } }),
    db.recurringCommitment.findMany({ where: { userId: poolId }, select: { merchant: true } }),
    db.allocation.aggregate({ where: { userId: poolId }, _max: { sortOrder: true } }),
    db.account.aggregate({ where: { userId: poolId }, _max: { sortOrder: true } }),
    db.debt.aggregate({ where: { userId: poolId }, _max: { sortOrder: true } }),
  ]);

  const budgeted = new Set(budgetedLines.map(b => b.allocationId));
  const usedAccounts = new Set([...usedByExpense, ...usedByIncome, ...usedByDebt].map(r => r.accountId!));
  const withId = (rows: { id: string; externalId: string | null }[]) =>
    rows.map(r => ({ id: r.id, externalId: r.externalId! }));

  return {
    memberAllocations: memberAllocations.map(a => ({ ...a, hasBudgetedMonth: budgeted.has(a.id) })),
    poolAllocations,
    memberAccounts: memberAccounts.map(a => ({ ...a, referenced: usedAccounts.has(a.id) })),
    memberExpenseExternalIds: withId(memberExpenses),
    memberIncomeExternalIds: withId(memberIncomes),
    poolExternalIds: {
      expense: new Set(poolExpenses.map(e => e.externalId!)),
      income: new Set(poolIncomes.map(i => i.externalId!)),
    },
    memberRules,
    poolRuleKeys: new Set(poolRules.map(r => `${r.matchType}|${r.pattern}`)),
    memberRecurring,
    poolRecurringMerchants: new Set(poolRecurring.map(r => r.merchant)),
    poolMaxSortOrder: {
      allocation: maxAllocation._max.sortOrder ?? -1,
      account: maxAccount._max.sortOrder ?? -1,
      debt: maxDebt._max.sortOrder ?? -1,
    },
  };
}

/** Counts only — what the repair script prints (no names, no amounts). */
export interface MergeSummary {
  incomes: number;
  expenses: number;
  accounts: number;
  debts: number;
  debtAdjustments: number;
  bankConnections: number;
  allocations: number;
  allocationsMerged: number;
  monthlyBudgets: number;
  lifePlans: number;
  planDeposits: number;
  rules: number;
  recurring: number;
  defaultAccountsDropped: number;
  duplicatesDropped: number; // expenses/incomes/rules/recurring the pool already has
}

export function isEmptySummary(s: MergeSummary): boolean {
  return Object.values(s).every(n => n === 0);
}

async function countRemaining(db: Db, memberId: string) {
  const where = { userId: memberId };
  const [incomes, expenses, accounts, debts, debtAdjustments, bankConnections, allocations, monthlyBudgets, lifePlans, planDeposits, rules, recurring] =
    await Promise.all([
      db.income.count({ where }), db.expense.count({ where }), db.account.count({ where }),
      db.debt.count({ where }), db.debtAdjustment.count({ where }), db.bankConnection.count({ where }),
      db.allocation.count({ where }), db.monthlyBudget.count({ where }), db.lifePlan.count({ where }),
      db.planDeposit.count({ where }), db.categorizationRule.count({ where }), db.recurringCommitment.count({ where }),
    ]);
  return { incomes, expenses, accounts, debts, debtAdjustments, bankConnections, allocations, monthlyBudgets, lifePlans, planDeposits, rules, recurring };
}

type RemainingCounts = Awaited<ReturnType<typeof countRemaining>>;

/** What the merge moves, from what's under her userId and the plan. */
export function summarizeMerge(c: RemainingCounts, plan: MergePlan): MergeSummary {
  const merged = plan.allocationRemap.size;
  return {
    incomes: c.incomes - plan.dropIncomeIds.length,
    expenses: c.expenses - plan.dropExpenseIds.length,
    accounts: c.accounts - plan.deleteAccountIds.length,
    debts: c.debts,
    debtAdjustments: c.debtAdjustments,
    bankConnections: c.bankConnections,
    allocations: c.allocations - merged,
    allocationsMerged: merged,
    // Budgets of a merged default are all 0 € and are dropped with it.
    monthlyBudgets: c.monthlyBudgets,
    lifePlans: c.lifePlans,
    planDeposits: c.planDeposits,
    rules: c.rules - plan.dropRuleIds.length,
    recurring: c.recurring - plan.dropRecurringIds.length,
    defaultAccountsDropped: plan.deleteAccountIds.length,
    duplicatesDropped: plan.dropExpenseIds.length + plan.dropIncomeIds.length + plan.dropRuleIds.length + plan.dropRecurringIds.length,
  };
}

async function prepare(db: Db, memberId: string, poolId: string) {
  const [input, counts] = await Promise.all([loadMergeInput(db, memberId, poolId), countRemaining(db, memberId)]);
  const plan = planPoolMerge(input);
  return { plan, summary: summarizeMerge(counts, plan) };
}

/** What a merge would do, without changing anything. */
export async function previewPoolMerge(db: Db, memberId: string, poolId: string): Promise<MergeSummary> {
  return (await prepare(db, memberId, poolId)).summary;
}

/**
 * Moves everything `memberId` has under her own userId into `poolId`, keeping
 * her as owner. Run it inside the same transaction as the link. Idempotent:
 * once moved nothing is left under her userId, so a re-run moves nothing.
 */
export async function mergeMemberIntoPool(
  db: Db,
  ctx: { memberId: string; poolId: string; householdId: string | null },
): Promise<MergeSummary> {
  const { memberId, poolId, householdId } = ctx;
  if (memberId === poolId) throw new Error("mergeMemberIntoPool: member and pool are the same user");

  const { plan, summary } = await prepare(db, memberId, poolId);
  const mine = { userId: memberId };
  const toPool = { userId: poolId };

  // 1. Untouched default lines merge into the pool's: repoint what uses them,
  //    then delete them (their 0 € MonthlyBudgets cascade).
  for (const [from, to] of plan.allocationRemap) {
    await db.expense.updateMany({ where: { ...mine, allocationId: from }, data: { allocationId: to } });
    await db.categorizationRule.updateMany({ where: { ...mine, allocationId: from }, data: { allocationId: to } });
    await db.recurringCommitment.updateMany({ where: { ...mine, allocationId: from }, data: { allocationId: to } });
  }
  if (plan.allocationRemap.size > 0) {
    await db.allocation.deleteMany({ where: { ...mine, id: { in: [...plan.allocationRemap.keys()] } } });
  }

  // 2. What the pool already has (unique constraints): the pool's row wins.
  if (plan.dropExpenseIds.length) await db.expense.deleteMany({ where: { ...mine, id: { in: plan.dropExpenseIds } } });
  if (plan.dropIncomeIds.length) await db.income.deleteMany({ where: { ...mine, id: { in: plan.dropIncomeIds } } });
  if (plan.dropRuleIds.length) await db.categorizationRule.deleteMany({ where: { ...mine, id: { in: plan.dropRuleIds } } });
  if (plan.dropRecurringIds.length) await db.recurringCommitment.deleteMany({ where: { ...mine, id: { in: plan.dropRecurringIds } } });
  if (plan.deleteAccountIds.length) await db.account.deleteMany({ where: { ...mine, id: { in: plan.deleteAccountIds } } });

  // 3. Move the rest. Ids don't change, so every foreign key between her rows
  //    (card account ↔ its debt, debt ↔ its budget line, expense ↔ account /
  //    line / debt, plan ↔ deposits) still holds.
  const personal = { visibility: "private", householdId };
  await db.allocation.updateMany({ where: mine, data: { ...toPool, sortOrder: { increment: plan.sortOffset.allocation } } });
  await db.bankConnection.updateMany({ where: mine, data: { ...toPool, ...personal } });
  await db.account.updateMany({ where: mine, data: { ...toPool, ...personal, sortOrder: { increment: plan.sortOffset.account } } });
  await db.debt.updateMany({ where: mine, data: { ...toPool, ...personal, sortOrder: { increment: plan.sortOffset.debt } } });
  await db.debtAdjustment.updateMany({ where: mine, data: toPool });
  // Legacy rows without a payer were paid by her; once in the pool the userId
  // no longer says so.
  await db.expense.updateMany({ where: { ...mine, payerUserId: null }, data: { payerUserId: memberId } });
  await db.expense.updateMany({ where: mine, data: toPool });
  await db.income.updateMany({ where: mine, data: toPool });
  await db.lifePlan.updateMany({ where: mine, data: toPool });
  await db.planDeposit.updateMany({ where: mine, data: toPool });
  await db.monthlyBudget.updateMany({ where: mine, data: toPool });
  await db.categorizationRule.updateMany({ where: mine, data: toPool });
  await db.recurringCommitment.updateMany({ where: mine, data: toPool });

  return summary;
}
