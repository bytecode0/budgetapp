// Email addresses as account keys (LPBETA-23 item 6). `Ana@x.com ` and
// `ana@x.com` are the same person: every address that comes in (register,
// login, codes, password reset, Google, partner invites, account deletion) is
// trimmed and lowercased before it is stored, compared or used as a key.
//
// Accounts created before this may still be stored with capitals, and two of
// them may collide once lowercased (`npm run check:email-duplicates` counts
// them). So an account is looked up case-insensitively, never with
// `findUnique({ where: { email } })`, and when several match the pick is
// deterministic: the one verified first, then the oldest (createdAt, then id).
// A never-verified duplicate is never chosen over a verified one.
//
// The lookup is raw SQL on purpose: Prisma's `mode: "insensitive"` compiles
// to ILIKE, where `_` and `%` in the typed address are wildcards (`a%@x.com`
// would match `ab@x.com`). Without an index on lower(email) it scans User,
// which is fine at this size.
import { Prisma, type PrismaClient } from "@prisma/client";

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** The id of the account that owns `email` (see above); null when none. */
export async function findUserIdByEmail(db: Pick<PrismaClient, "$queryRaw">, email: string): Promise<string | null> {
  const address = normalizeEmail(email);
  if (!address) return null;
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id" FROM "User" WHERE lower(btrim("email")) = ${address}
    ORDER BY "emailVerified" ASC NULLS LAST, "createdAt" ASC, "id" ASC
    LIMIT 1`);
  return rows[0]?.id ?? null;
}
