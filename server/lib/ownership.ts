// Who may change or delete a per-person record (Account, Debt, Income) in a
// shared pool. Lookups by `userId` only prove the record is in the caller's
// pool; a household member must not edit or delete another member's records.
//
//   "ok"        → the caller owns it
//   "hidden"    → another member's private record: the caller can't even see
//                 it, so answer as if it didn't exist (404)
//   "forbidden" → another member's visible record: read-only for the caller (403)
export type MutationAccess = "ok" | "hidden" | "forbidden";

export function mutationAccess(
  record: { ownerUserId: string; visibility?: string },
  authUserId: string | undefined,
): MutationAccess {
  if (authUserId && record.ownerUserId === authUserId) return "ok";
  return record.visibility === "private" ? "hidden" : "forbidden";
}

/** Prisma `where` fragment for the per-person records a caller can see: their
 *  own plus other members' household-shared ones (private ones are hidden).
 *  The same rule GET uses, so reorder can't touch rows the caller can't see. */
export function visibleToWhere(authUserId: string) {
  return { OR: [{ ownerUserId: authUserId }, { visibility: "household" }] };
}

/** Keeps the reorder entries that name a row visible to the caller (see
 *  visibleToWhere) with an integer sortOrder. Others are dropped silently:
 *  the client only ever sends the list it was shown. */
export function reorderableEntries(
  order: { id: string; sortOrder: number }[],
  visibleIds: ReadonlySet<string>,
): { id: string; sortOrder: number }[] {
  return order.filter(e =>
    e && typeof e.id === "string" && visibleIds.has(e.id) && Number.isInteger(e.sortOrder));
}
