// Password sign-in throttling (LPBETA-14), counted in the database: on Vercel an
// in-memory counter is per instance and forgets on a cold start
// (see rateLimit.ts), so it can't stop someone guessing passwords.
//
// Every try reserves an attempt atomically BEFORE the password is compared, so
// a burst of parallel requests can't all compare against a counter that still
// reads 0. After LOGIN_MAX_FAILURES tries without a success, password sign-in
// is locked for LOGIN_LOCK_MS. A success, or resetting the password, clears it.

import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeEmail } from "./emailAddress.js";
import { utc } from "./rateLimit.js";

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

/** The subset of the Prisma client the throttle needs (a fake in tests). */
export interface LoginThrottleStore {
  user: {
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  };
}

/** "ok": compare the password now. "locked": refuse without comparing. */
export async function reserveLoginAttempt(
  db: LoginThrottleStore,
  userId: string,
  now: Date = new Date(),
): Promise<"ok" | "locked"> {
  // A lock that has run out starts the count again.
  await db.user.updateMany({
    where: { id: userId, loginLockedUntil: { lte: now } },
    data: { failedLogins: 0, loginLockedUntil: null },
  });

  const reserved = await db.user.updateMany({
    where: { id: userId, loginLockedUntil: null, failedLogins: { lt: LOGIN_MAX_FAILURES } },
    data: { failedLogins: { increment: 1 } },
  });
  if (reserved.count === 1) return "ok";

  // Out of attempts (or already locked): the first request to get here sets the lock.
  await db.user.updateMany({
    where: { id: userId, loginLockedUntil: null },
    data: { loginLockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS) },
  });
  return "locked";
}

/** After a correct password or a password reset. */
export async function clearLoginFailures(db: LoginThrottleStore, userId: string): Promise<void> {
  await db.user.updateMany({ where: { id: userId }, data: { failedLogins: 0, loginLockedUntil: null } });
}

// ── Emails with no account (LPBETA-23 item 5) ──────────────────────────
//
// The lock above lives on the User row, so on its own only an email WITH an
// account would ever answer 429: guessing at an address would tell whether it
// has an account. An email with no account goes through the same steps
// instead, kept in a RateLimitHit row (no schema of its own) under a key that
// is a hash of the address, so the 429 comes after the same number of tries
// and lasts the same time:
//   count 1..LOGIN_MAX_FAILURES  = failed tries; windowStart = the last one
//   count LOGIN_MAX_FAILURES + 1 = locked until windowStart
// The transaction takes an advisory lock on the key, so parallel tries are
// counted one by one like the row lock of the User update above.
// Known difference: the rate-limit cleanup deletes rows older than two days,
// so a partial count left alone that long starts over (an account keeps it).

export function unknownLoginKey(email: string): string {
  return `login-unknown:${createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32)}`;
}

/** Same answers as reserveLoginAttempt, for an email with no account (no password is ever right). */
export async function reserveUnknownLoginAttempt(
  db: Pick<PrismaClient, "$transaction">,
  email: string,
  now: Date = new Date(),
): Promise<"ok" | "locked"> {
  const key = unknownLoginKey(email);
  return db.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    const rows = await tx.$queryRaw<{ ms: number; count: number }[]>(Prisma.sql`
      SELECT (EXTRACT(EPOCH FROM "windowStart") * 1000)::float8 AS "ms", "count"
      FROM "RateLimitHit" WHERE "key" = ${key}`);
    let failures = 0;
    let lockedUntil: number | null = null;
    for (const r of rows) {
      if (r.count > LOGIN_MAX_FAILURES) lockedUntil = r.ms;
      else failures = r.count;
    }
    // A lock that has run out starts the count again.
    if (lockedUntil !== null && lockedUntil <= now.getTime()) {
      failures = 0;
      lockedUntil = null;
    }
    if (lockedUntil !== null) return "locked";

    const write = async (windowStart: Date, count: number) => {
      await tx.$executeRaw(Prisma.sql`DELETE FROM "RateLimitHit" WHERE "key" = ${key}`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "RateLimitHit" ("key", "windowStart", "count") VALUES (${key}, ${utc(windowStart)}, ${count})`);
    };
    if (failures < LOGIN_MAX_FAILURES) {
      await write(now, failures + 1);
      return "ok";
    }
    await write(new Date(now.getTime() + LOGIN_LOCK_MS), LOGIN_MAX_FAILURES + 1);
    return "locked";
  });
}
