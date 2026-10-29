// Ids a request body names must belong to the caller's pool (req.userId).
// Writing a row that points at another pool's budget line would, for a plan
// line, credit that user's life plan. Unknown or foreign ids answer 404 with a
// code the client translates (src/app/lib/apiErrors.ts), never a 500.
import { prisma } from "./prisma.js";

export const ALLOCATION_NOT_FOUND = { error: "Category not found", code: "allocation_not_found" };

/** True when every id given (null/undefined/"" = no category, skipped) is a
 *  budget line of pool `userId`. A non-string id is never one. */
export async function allocationsInPool(userId: string, ids: readonly unknown[]): Promise<boolean> {
  const named = ids.filter(id => id !== undefined && id !== null && id !== "");
  if (named.some(id => typeof id !== "string")) return false;
  const unique = [...new Set(named as string[])];
  if (unique.length === 0) return true;
  const found = await prisma.allocation.count({ where: { userId, id: { in: unique } } });
  return found === unique.length;
}
