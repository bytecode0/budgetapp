// What each person sees of banking outside Accounts (Activity's strip, Home's
// notice): the dismissed "connect your bank" prompt, and pending reviews only
// for the connection's owner. Pure but for the one write, which takes its db.

/** The slice of the Prisma client the dismissal writes through. */
export interface PromptSettingsDb {
  userSettings: {
    upsert(args: {
      where: { userId: string };
      update: { bankPromptDismissedAt: Date };
      create: { userId: string; bankPromptDismissedAt: Date };
    }): Promise<unknown>;
  };
}

/** Closes the "connect your bank" strip for good. Stored on the REAL person's
 *  settings (req.authUserId), never the pool's: a partner dismissing it hides
 *  it only for themselves. */
export async function dismissBankPrompt(db: PromptSettingsDb, authUserId: string, now: Date): Promise<void> {
  await db.userSettings.upsert({
    where: { userId: authUserId },
    update: { bankPromptDismissedAt: now },
    create: { userId: authUserId, bankPromptDismissedAt: now },
  });
}

interface ViewedAccount { bankPendingReview: number; bankSyncNotice: string | null }

/** A connection as the caller may see it. Only its owner can review it, so a
 *  household member never gets its pending counts or held-movement notices. */
export function connectionForViewer<A extends ViewedAccount, C extends { ownerUserId: string; accounts: A[] }>(
  connection: C,
  authUserId: string,
): C & { isOwner: boolean } {
  const isOwner = connection.ownerUserId === authUserId;
  if (isOwner) return { ...connection, isOwner };
  return {
    ...connection,
    isOwner,
    accounts: connection.accounts.map(a => ({ ...a, bankPendingReview: 0, bankSyncNotice: null })),
  };
}
