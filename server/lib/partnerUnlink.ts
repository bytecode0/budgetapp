// Moving a partner's own data back out of the pool when the couple unlinks —
// the reverse of server/lib/partnerMerge.ts. Without it, everything she merged
// on accept (or entered while linked) would stay in her ex's pool, readable by
// the ex and invisible to her.
//
// Who is "the member": the partner whose UserSettings.linkedUserId points at
// the pool, whichever of the two presses unlink. The pool owner keeps the pool.
//
// What moves back to her own scope (userId = member), model by model:
//   Account, Debt,
//   BankConnection    → those she owns (ownerUserId), except a debt and the
//                       account it is linked to (Debt.accountId) whose owners
//                       differ: that pair stays in the pool, together with
//                       whatever else hangs on either. The account's
//                       purchases feed the debt's balance and how its payments
//                       split (debtBalance.ts, for every kind of debt), and
//                       those are read within one userId — splitting the pair,
//                       or clearing the link, would change a balance. Such a
//                       pair can only predate the same-owner rule
//                       (server/lib/debtAccountLink.ts). householdId cleared,
//                       visibility back to the schema default "household" —
//                       what a solo user's rows have (she is alone in her
//                       scope; a later accept makes them private again).
//                       A moved BankConnection keeps syncing into her scope:
//                       sync writes to connection.userId.
//   DebtAdjustment    → those of the debts that move (they follow the debt).
//   Income            → those she earned (ownerUserId).
//   Expense           → hers if she entered it (createdByUserId) or it is on
//                       her account — but never in a way that changes a debt
//                       balance on either side (debtBalance.ts reads payments
//                       by debtId and purchases by the debt's accountId, both
//                       within one userId):
//                         - a payment (debtId set): moves iff its debt moves,
//                           whoever entered it;
//                         - else on an account that backs a debt (a purchase
//                           on a card): moves iff the account moves, whoever
//                           entered it;
//                         - else on another account: moves iff the account
//                           moves (her bank data — shared ones too, with their
//                           shares) or she entered it (then the ex's account
//                           is cleared from it; account balances are stored,
//                           not derived from expenses, so none changes);
//                         - else (no account): moves iff she entered it, or
//                           she paid it and it is not a shared expense with
//                           shares — one the ex entered is household history
//                           both have a claim on, so it stays with the pool.
//   LifePlan          → those she owns (ownerUserId: set on create, and at
//                       merge for the plans she brought). Plans without an
//                       owner (made in the pool before the column) stay.
//   PlanDeposit       → those of her plans (they follow the plan).
//   Allocation        → there is no owner on a budget line, so lines stay with
//                       the pool, except the debt lines of the debts that move
//                       and the plan lines of her plans (they move, with their
//                       MonthlyBudgets and the rules pointing at them). A
//                       fixed/flexible/generosity line her moved expenses use
//                       is COPIED into her scope (0 € budgeted) so they keep
//                       their category; other plan and debt lines are not
//                       copied — those expenses become uncategorised.
//   MonthlyBudget (other lines), CategorizationRule (other lines),
//   RecurringCommitment → stay with the pool (no owner).
//   HouseholdMember   → her membership in the owner's household is removed.
//
// externalId: a moved Expense/Income that merge namespaced
// (`merged:<id>[#n]:<original>`, server/lib/partnerMerge.ts) gets its original
// id back when no other row in her scope has it, so re-importing the same
// statement is still recognised as a duplicate. When it is taken, the row
// keeps its namespaced id (a later merge rebuilds it from the original).
//
// Any other reference that would cross the two scopes after the move (e.g. an
// ex's expense in her debt line, the ex's income paid into her account) is
// cleared. Debt.accountId never crosses (see above), so no debt balance
// changes on either side.
//
// planUnlink() holds every decision as a pure function (unit-tested in
// partnerUnlink.test.ts); loadUnlinkInput() and unlinkMemberFromPool() are the
// database around it.
import type { Prisma } from "@prisma/client";
import { originalExternalId } from "./partnerMerge.js";

type Db = Prisma.TransactionClient;

export interface UnlinkInput {
  memberId: string;
  accounts: { id: string; ownerUserId: string; bankConnectionId: string | null }[];
  debts: { id: string; ownerUserId: string; accountId: string | null; bankConnectionId: string | null }[];
  bankConnections: { id: string; ownerUserId: string }[];
  incomes: { id: string; ownerUserId: string; accountId: string | null; externalId: string | null }[];
  expenses: {
    id: string; accountId: string | null; externalId: string | null; debtId: string | null; allocationId: string | null;
    payerUserId: string | null; createdByUserId: string | null; scope: string; hasShares: boolean;
  }[];
  plans: { id: string; ownerUserId: string | null }[];
  allocations: { id: string; type: string; debtId: string | null; lifePlanId: string | null }[];
  rules: { id: string; allocationId: string }[];
  recurring: { id: string; allocationId: string | null }[];
  /** externalIds already under her own userId (rows she has outside the pool). */
  memberExternalIds: { expense: Set<string>; income: Set<string> };
}

export interface UnlinkPlan {
  move: {
    accountIds: string[];
    debtIds: string[];
    bankConnectionIds: string[];
    incomeIds: string[];
    expenseIds: string[];
    planIds: string[];
    allocationIds: string[]; // debt lines of moving debts, plan lines of her plans
    ruleIds: string[];       // rules pointing at those lines
  };
  /** Pool lines to copy into her scope → her moved expenses that use each. */
  copyAllocations: Map<string, string[]>;
  /** Moved rows whose original externalId is free in her scope: set after the move. */
  restoreExternalIds: { expense: ExternalIdChange[]; income: ExternalIdChange[] };
  /** References that would cross scopes after the move: set to null. */
  clear: {
    expenseAccount: string[];
    expenseAllocation: string[];
    incomeAccount: string[];
    debtBankConnection: string[];
    accountBankConnection: string[];
    recurringAllocation: string[];
  };
}

export interface ExternalIdChange { id: string; externalId: string }

/**
 * The moved rows that get their pre-merge externalId back: those whose
 * original is in no other row of her scope (what she already has there, and
 * the other moved rows as they end up).
 */
export function planRestoreExternalIds(
  moving: { id: string; externalId: string | null }[],
  herScope: Set<string>,
): ExternalIdChange[] {
  const taken = new Set(herScope);
  for (const r of moving) if (r.externalId !== null) taken.add(r.externalId);
  const out: ExternalIdChange[] = [];
  for (const r of moving) {
    if (r.externalId === null) continue;
    const original = originalExternalId(r.externalId);
    if (original === r.externalId || taken.has(original)) continue;
    taken.delete(r.externalId);
    taken.add(original);
    out.push({ id: r.id, externalId: original });
  }
  return out;
}

const COPYABLE_LINE_TYPES = new Set(["fixed", "flexible", "generosity"]);

/** True when exactly one side of a reference moves (it would cross scopes). */
function crosses(fromMoves: boolean, target: string | null, moving: Set<string>): boolean {
  return target !== null && fromMoves !== moving.has(target);
}

/**
 * Her accounts and debts that can move: hers, minus every debt–account link
 * whose two ends would land in different scopes — both ends stay. Repeated
 * until stable, since keeping an account in the pool can strand another debt
 * of hers linked to it.
 */
function movableAccountsAndDebts(input: UnlinkInput): { accounts: Set<string>; debts: Set<string> } {
  const hers = (r: { ownerUserId: string }) => r.ownerUserId === input.memberId;
  const accounts = new Set(input.accounts.filter(hers).map(a => a.id));
  const debts = new Set(input.debts.filter(hers).map(d => d.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const d of input.debts) {
      if (d.accountId === null || debts.has(d.id) === accounts.has(d.accountId)) continue;
      debts.delete(d.id);
      accounts.delete(d.accountId);
      changed = true;
    }
  }
  return { accounts, debts };
}

export function planUnlink(input: UnlinkInput): UnlinkPlan {
  const hers = (r: { ownerUserId: string }) => r.ownerUserId === input.memberId;
  const { accounts, debts } = movableAccountsAndDebts(input);
  const connections = new Set(input.bankConnections.filter(hers).map(c => c.id));
  const incomes = new Set(input.incomes.filter(hers).map(i => i.id));
  const plans = new Set(input.plans.filter(p => p.ownerUserId === input.memberId).map(p => p.id));
  const allocations = new Set(input.allocations
    .filter(a => (a.debtId !== null && debts.has(a.debtId)) || (a.lifePlanId !== null && plans.has(a.lifePlanId)))
    .map(a => a.id));

  const backsDebt = new Set(input.debts.map(d => d.accountId).filter((id): id is string => id !== null));
  const enteredByHer = (e: UnlinkInput["expenses"][number]) => e.createdByUserId === input.memberId;
  const expenseMoves = (e: UnlinkInput["expenses"][number]) =>
    e.debtId !== null ? debts.has(e.debtId)
      : e.accountId !== null && backsDebt.has(e.accountId) ? accounts.has(e.accountId)
      : e.accountId !== null ? accounts.has(e.accountId) || enteredByHer(e)
      : enteredByHer(e) || (e.payerUserId === input.memberId && !(e.scope === "shared" && e.hasShares));
  const expenses = new Set(input.expenses.filter(expenseMoves).map(e => e.id));

  // Her moved expenses in a pool line that stays: copy the line if it is a
  // plain category, otherwise leave them uncategorised.
  const lineType = new Map(input.allocations.map(a => [a.id, a.type]));
  const copyAllocations = new Map<string, string[]>();
  const expenseAllocation: string[] = [];
  for (const e of input.expenses) {
    const moves = expenses.has(e.id);
    if (!crosses(moves, e.allocationId, allocations)) continue;
    if (moves && COPYABLE_LINE_TYPES.has(lineType.get(e.allocationId!) ?? "")) {
      copyAllocations.set(e.allocationId!, [...(copyAllocations.get(e.allocationId!) ?? []), e.id]);
    } else {
      expenseAllocation.push(e.id);
    }
  }

  return {
    move: {
      accountIds: [...accounts],
      debtIds: [...debts],
      bankConnectionIds: [...connections],
      incomeIds: [...incomes],
      expenseIds: [...expenses],
      planIds: [...plans],
      allocationIds: [...allocations],
      ruleIds: input.rules.filter(r => allocations.has(r.allocationId)).map(r => r.id),
    },
    copyAllocations,
    restoreExternalIds: {
      expense: planRestoreExternalIds(input.expenses.filter(e => expenses.has(e.id)), input.memberExternalIds.expense),
      income: planRestoreExternalIds(input.incomes.filter(i => incomes.has(i.id)), input.memberExternalIds.income),
    },
    clear: {
      // A moving expense's debt is always hers and a staying one's never is,
      // so Expense.debtId can't cross.
      expenseAccount: input.expenses.filter(e => crosses(expenses.has(e.id), e.accountId, accounts)).map(e => e.id),
      expenseAllocation,
      incomeAccount: input.incomes.filter(i => crosses(incomes.has(i.id), i.accountId, accounts)).map(i => i.id),
      debtBankConnection: input.debts.filter(d => crosses(debts.has(d.id), d.bankConnectionId, connections)).map(d => d.id),
      accountBankConnection: input.accounts.filter(a => crosses(accounts.has(a.id), a.bankConnectionId, connections)).map(a => a.id),
      recurringAllocation: input.recurring.filter(r => crosses(false, r.allocationId, allocations)).map(r => r.id),
    },
  };
}

export async function loadUnlinkInput(db: Db, memberId: string, poolId: string): Promise<UnlinkInput> {
  const pool = { userId: poolId };
  const hersWithId = { userId: memberId, externalId: { not: null } };
  const [accounts, debts, bankConnections, incomes, expenses, plans, allocations, rules, recurring, memberExpenseIds, memberIncomeIds] = await Promise.all([
    db.account.findMany({ where: pool, select: { id: true, ownerUserId: true, bankConnectionId: true } }),
    db.debt.findMany({ where: pool, select: { id: true, ownerUserId: true, accountId: true, bankConnectionId: true } }),
    db.bankConnection.findMany({ where: pool, select: { id: true, ownerUserId: true } }),
    db.income.findMany({ where: pool, select: { id: true, ownerUserId: true, accountId: true, externalId: true } }),
    db.expense.findMany({
      where: pool,
      select: {
        id: true, accountId: true, externalId: true, debtId: true, allocationId: true, payerUserId: true, createdByUserId: true, scope: true,
        _count: { select: { shares: true } },
      },
    }),
    db.lifePlan.findMany({ where: pool, select: { id: true, ownerUserId: true } }),
    db.allocation.findMany({ where: pool, select: { id: true, type: true, debtId: true, lifePlanId: true } }),
    db.categorizationRule.findMany({ where: pool, select: { id: true, allocationId: true } }),
    db.recurringCommitment.findMany({ where: pool, select: { id: true, allocationId: true } }),
    db.expense.findMany({ where: hersWithId, select: { externalId: true } }),
    db.income.findMany({ where: hersWithId, select: { externalId: true } }),
  ]);
  return {
    memberId,
    accounts, debts, bankConnections, incomes, plans, allocations, rules, recurring,
    expenses: expenses.map(({ _count, ...e }) => ({ ...e, hasShares: _count.shares > 0 })),
    memberExternalIds: {
      expense: new Set(memberExpenseIds.map(e => e.externalId!)),
      income: new Set(memberIncomeIds.map(i => i.externalId!)),
    },
  };
}

// Postgres caps bind parameters per statement; a big expense history must not hit it.
const CHUNK = 5000;
async function inChunks(ids: string[], run: (chunk: string[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += CHUNK) await run(ids.slice(i, i + CHUNK));
}

/**
 * Unlinks `memberId` from `poolId` and moves what is hers back to her own
 * scope (see the header). Run it inside one transaction: the link is cleared
 * here too, so either everything happens or nothing does.
 */
export async function unlinkMemberFromPool(db: Db, ctx: { memberId: string; poolId: string }): Promise<void> {
  const { memberId, poolId } = ctx;
  if (memberId === poolId) throw new Error("unlinkMemberFromPool: member and pool are the same user");
  const plan = planUnlink(await loadUnlinkInput(db, memberId, poolId));
  const { move, clear } = plan;
  const toHer = { userId: memberId };

  // 1. Copies of the pool lines her moved expenses use, and repoint them.
  if (plan.copyAllocations.size > 0) {
    const sources = await db.allocation.findMany({
      where: { id: { in: [...plan.copyAllocations.keys()] } },
      select: { id: true, name: true, icon: true, type: true, sortOrder: true },
    });
    for (const s of sources) {
      const copy = await db.allocation.create({
        data: { userId: memberId, name: s.name, icon: s.icon, type: s.type, sortOrder: s.sortOrder, allocatedAmount: 0, actualAmount: 0 },
      });
      await inChunks(plan.copyAllocations.get(s.id)!, ids =>
        db.expense.updateMany({ where: { id: { in: ids } }, data: { allocationId: copy.id } }));
    }
  }

  // 2. Clear references that would cross the two scopes.
  await inChunks(clear.expenseAccount, ids => db.expense.updateMany({ where: { id: { in: ids } }, data: { accountId: null } }));
  await inChunks(clear.expenseAllocation, ids => db.expense.updateMany({ where: { id: { in: ids } }, data: { allocationId: null } }));
  await inChunks(clear.incomeAccount, ids => db.income.updateMany({ where: { id: { in: ids } }, data: { accountId: null } }));
  await db.debt.updateMany({ where: { id: { in: clear.debtBankConnection } }, data: { bankConnectionId: null } });
  await db.account.updateMany({ where: { id: { in: clear.accountBankConnection } }, data: { bankConnectionId: null } });
  await db.recurringCommitment.updateMany({ where: { id: { in: clear.recurringAllocation } }, data: { allocationId: null } });

  // 3. Move hers back. Ids don't change, so links among her rows hold.
  const solo = { ...toHer, householdId: null, visibility: "household" };
  await db.bankConnection.updateMany({ where: { id: { in: move.bankConnectionIds } }, data: solo });
  await db.account.updateMany({ where: { id: { in: move.accountIds } }, data: solo });
  await db.debt.updateMany({ where: { id: { in: move.debtIds } }, data: solo });
  await db.debtAdjustment.updateMany({ where: { debtId: { in: move.debtIds } }, data: toHer });
  await inChunks(move.incomeIds, ids => db.income.updateMany({ where: { id: { in: ids } }, data: toHer }));
  await inChunks(move.expenseIds, ids => db.expense.updateMany({ where: { id: { in: ids } }, data: toHer }));
  await db.lifePlan.updateMany({ where: { id: { in: move.planIds } }, data: toHer });
  await db.planDeposit.updateMany({ where: { planId: { in: move.planIds } }, data: toHer });
  await db.allocation.updateMany({ where: { id: { in: move.allocationIds } }, data: toHer });
  await db.monthlyBudget.updateMany({ where: { allocationId: { in: move.allocationIds } }, data: toHer });
  await db.categorizationRule.updateMany({ where: { id: { in: move.ruleIds } }, data: toHer });

  // 4. Original externalIds back, now that the rows are in her scope.
  for (const r of plan.restoreExternalIds.expense) await db.expense.update({ where: { id: r.id }, data: { externalId: r.externalId } });
  for (const r of plan.restoreExternalIds.income) await db.income.update({ where: { id: r.id }, data: { externalId: r.externalId } });

  // 5. The link itself, and her place in the owner's household.
  await db.userSettings.update({ where: { userId: memberId }, data: { linkedUserId: null } });
  await db.householdMember.deleteMany({
    where: { userId: memberId, role: { not: "owner" }, household: { members: { some: { userId: poolId, role: "owner" } } } },
  });
}
