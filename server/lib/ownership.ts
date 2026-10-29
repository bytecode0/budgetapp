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
