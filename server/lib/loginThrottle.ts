// Password sign-in throttling (LPBETA-14), counted in the database: on Vercel an
// in-memory counter is per instance and forgets on a cold start
// (see rateLimit.ts), so it can't stop someone guessing passwords.
//
// Every try reserves an attempt atomically BEFORE the password is compared, so
// a burst of parallel requests can't all compare against a counter that still
// reads 0. After LOGIN_MAX_FAILURES tries without a success, password sign-in
// is locked for LOGIN_LOCK_MS. A success, or resetting the password, clears it.

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
