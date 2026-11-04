// Ids a request body names must belong to the caller's pool (req.userId) and
// be visible to them (req.authUserId).
// Writing a row that points at another pool's budget line would, for a plan
// line, credit that user's life plan. Unknown or foreign ids answer 404 with a
// code the client translates (src/app/lib/apiErrors.ts), never a 500.
import { prisma } from "./prisma.js";
import { visibleToWhere } from "./ownership.js";

export const ALLOCATION_NOT_FOUND = { error: "Category not found", code: "allocation_not_found" };
export const ACCOUNT_NOT_FOUND = { error: "Account not found", code: "account_not_found" };

// A debt hidden from the caller (another member's private one, see
// visibleToWhere) is hidden together with its budget line and its payments:
// they would show its name and id, and writing on them would change its
// balance. Prisma `where` fragments for a row with a `debt` relation
// (Allocation, Expense): `onHiddenDebt` matches the rows on such a debt,
// `notOnHiddenDebt` every other one (no debt at all included). Aggregate
// totals still count them, as they count the debt's balance.
export function onHiddenDebt(authUserId: string) {
  return { debt: { is: { NOT: visibleToWhere(authUserId) } } };
}
export function notOnHiddenDebt(authUserId: string) {
  return { NOT: onHiddenDebt(authUserId) };
}

/** Rows (CategorizationRule, RecurringCommitment) not pointing at the budget
 *  line of a debt hidden from the caller. */
export function onHiddenLine(authUserId: string) {
  return { allocation: { is: onHiddenDebt(authUserId) } };
}
export function notOnHiddenLine(authUserId: string) {
  return { NOT: onHiddenLine(authUserId) };
}

// A private account is hidden from the other member in every visibility
// tier together with the movements on it (a private card's purchases make
// its debt's balance). An expense is hidden when it pays a hidden debt, sits
// on a hidden debt's line or on a hidden account; an income when it sits on a
// hidden account. `NOT` matches rows with no account/debt/line too.
const onHiddenAccount = (authUserId: string) => ({ account: { is: { NOT: visibleToWhere(authUserId) } } });
export function hiddenExpenseWhere(authUserId: string) {
  return { OR: [onHiddenDebt(authUserId), onHiddenLine(authUserId), onHiddenAccount(authUserId)] };
}
export function visibleExpenseWhere(authUserId: string) {
  return { NOT: hiddenExpenseWhere(authUserId) };
}
export function hiddenIncomeWhere(authUserId: string) {
  return onHiddenAccount(authUserId);
}
export function visibleIncomeWhere(authUserId: string) {
  return { NOT: hiddenIncomeWhere(authUserId) };
}

/** Ids of pool `userId`'s budget lines hidden from `authUserId`, for the read
 *  paths that sum every line but list only the visible ones. */
export async function hiddenLineIds(userId: string, authUserId: string): Promise<Set<string>> {
  const lines = await prisma.allocation.findMany({ where: { userId, ...onHiddenDebt(authUserId) }, select: { id: true } });
  return new Set(lines.map(l => l.id));
}

/** What the lines hidden from the caller commit, in cents: one figure, never
 *  their names or ids, so budget totals listed without them still add up to
 *  the household's (/review). A line's budget for `month` when saved, else
 *  its debt's commitment for the period (`commitments`, from debtCommitments,
 *  which the caller has already computed). */
export async function hiddenCommitted(
  userId: string, authUserId: string, commitments: ReadonlyMap<string, number>, month?: string,
): Promise<number> {
  const lines = await prisma.allocation.findMany({
    where: { userId, ...onHiddenDebt(authUserId) },
    select: { id: true, debtId: true, allocatedAmount: true },
  });
  if (lines.length === 0) return 0;
  const saved = month
    ? await prisma.monthlyBudget.findMany({ where: { month, allocationId: { in: lines.map(l => l.id) } }, select: { allocationId: true, allocatedAmount: true } })
    : [];
  const savedBy = new Map(saved.map(b => [b.allocationId, b.allocatedAmount]));
  return lines.reduce((s, l) => s + (savedBy.get(l.id) ?? (l.debtId ? commitments.get(l.debtId) : undefined) ?? l.allocatedAmount), 0);
}

/** True when every id given (null/undefined/"" = no category, skipped) is a
 *  budget line of pool `userId` visible to `authUserId`. A non-string id is
 *  never one. */
export async function allocationsInPool(userId: string, authUserId: string, ids: readonly unknown[]): Promise<boolean> {
  const named = ids.filter(id => id !== undefined && id !== null && id !== "");
  if (named.some(id => typeof id !== "string")) return false;
  const unique = [...new Set(named as string[])];
  if (unique.length === 0) return true;
  const found = await prisma.allocation.count({ where: { userId, id: { in: unique }, ...notOnHiddenDebt(authUserId) } });
  return found === unique.length;
}
