// Before normalising stored emails (LPBETA-23 item 6): how many accounts would
// collide once trimmed and lowercased (`Ana@x.com` and `ana@x.com`), and how
// many are stored un-normalised. Prints counts only — never an email, name or
// id. Read-only. Against production, Luis runs it in his own terminal with
// the Neon URL between the quotes:
//
//   DATABASE_URL='' npm run check:email-duplicates
//
// Zero collisions → the lowercasing SQL in the PR can run. Otherwise the
// colliding accounts must be resolved by hand first. Until then the app still
// works: lookups pick the account verified first, then the oldest
// (server/lib/emailAddress.ts).
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

// Its own client with Prisma's logging off: Prisma would print full error
// messages, which can echo values. Errors are reported by name and code only.
const prisma = new PrismaClient({ log: [] });

function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}

export interface EmailDuplicateCounts {
  /** Accounts with an email. */
  accounts: number;
  /** Stored with capitals or surrounding spaces. */
  notNormalised: number;
  /** Normalised addresses held by more than one account. */
  collidingAddresses: number;
  /** Accounts sharing one of those addresses. */
  collidingAccounts: number;
  /** Of those accounts, how many are verified. */
  collidingVerified: number;
}

export async function checkEmailDuplicates(db: Pick<PrismaClient, "$queryRaw"> = prisma): Promise<EmailDuplicateCounts> {
  const [row] = await db.$queryRaw<{
    accounts: number; notNormalised: number; collidingAddresses: number; collidingAccounts: number; collidingVerified: number;
  }[]>`
    WITH u AS (
      SELECT lower(btrim("email")) AS norm, "email", "emailVerified" FROM "User" WHERE "email" IS NOT NULL
    ), dup AS (
      SELECT norm FROM u GROUP BY norm HAVING count(*) > 1
    )
    SELECT
      (SELECT count(*) FROM u)::int AS "accounts",
      (SELECT count(*) FROM u WHERE "email" <> norm)::int AS "notNormalised",
      (SELECT count(*) FROM dup)::int AS "collidingAddresses",
      (SELECT count(*) FROM u WHERE norm IN (SELECT norm FROM dup))::int AS "collidingAccounts",
      (SELECT count(*) FROM u WHERE norm IN (SELECT norm FROM dup) AND "emailVerified" IS NOT NULL)::int AS "collidingVerified"`;
  return row;
}

export function formatEmailDuplicates(c: EmailDuplicateCounts): string {
  return [
    `Accounts with an email:            ${c.accounts}`,
    `Stored with capitals or spaces:    ${c.notNormalised}`,
    `Addresses that collide:            ${c.collidingAddresses}`,
    `Accounts on those addresses:       ${c.collidingAccounts} (verified: ${c.collidingVerified})`,
    c.collidingAddresses === 0
      ? "No collisions: the lowercasing SQL can run."
      : "Collisions found: do NOT run the lowercasing SQL; resolve these accounts first.",
  ].join("\n");
}

// Run as a script (npm run check:email-duplicates), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkEmailDuplicates()
    .then(async (counts) => {
      console.log(formatEmailDuplicates(counts));
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(`Check failed (${errorTag(e)})`);
      await prisma.$disconnect();
      process.exit(1);
    });
}
