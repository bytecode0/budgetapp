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

/** Ids of pool `userId`'s budget lines hidden from `authUserId`, for the read
 *  paths that sum every line but list only the visible ones. */
export async function hiddenLineIds(userId: string, authUserId: string): Promise<Set<string>> {
  const lines = await prisma.allocation.findMany({ where: { userId, ...onHiddenDebt(authUserId) }, select: { id: true } });
  return new Set(lines.map(l => l.id));
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
