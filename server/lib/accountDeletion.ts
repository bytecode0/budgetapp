// Deleting an account (LPBETA-09), with 24 hours to change your mind.
//
//   1. Request (POST /api/account/deletion, with an email code): marks
//      User.deletionRequestedAt and emails a "cancel" link that opens the app.
//   2. Cancel (DELETE /api/account/deletion, signed in): clears the mark.
//   3. Purge (the daily job, GET /api/account/cron with CRON_SECRET): every
//      account marked more than 24 h ago is deleted. One run a day, so an
//      account goes 24–48 h after the request.
//
// Purge of one user, in this order, each step safe to run again:
//   a. Household: if linked to a partner, unlink first with the same code as
//      DELETE /api/partner/unlink (server/lib/partnerUnlink.ts). Whoever is
//      deleted, the PARTNER is always the one unlinkMemberFromPool moves: if
//      the deleted user is the member, her data moves to her own scope (and is
//      deleted with her); if the deleted user owns the pool, the partner's data
//      moves out to the partner first, so deleting the pool keeps it.
//   b. Bank connections: revoke each provider session (best effort, as the
//      DELETE /api/banking/connections/:id route does).
//   c. Stripe: cancel the subscription now, only when Stripe is configured. A
//      Stripe error stops this user's purge (retried tomorrow): deleting the
//      account would leave a subscription charging nobody we can reach.
//   d. Delete the user — every relation cascades (prisma/schema.prisma) — and
//      her one-time codes, and the households left without members.
//   e. Email "your account was deleted" (a failure is logged, not retried).
//
// A cancel can land while a purge runs: the unlink re-checks the mark under a
// row lock, and the delete itself only matches a still-marked user. Logs name
// a user only by id, as the rest of the server does, never by email.
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockSettings } from "./partnerLink.js";
import { unlinkMemberFromPool } from "./partnerUnlink.js";
import { decrypt } from "./crypto/secretBox.js";
import { syncErrorCode } from "./banking/sync.js";
import type { BankingProviderClient } from "./banking/types.js";
import { resolveLocale, type EmailLocale } from "./email/locales/index.js";

export const DELETION_GRACE_MS = 24 * 60 * 60 * 1000;

/** The earliest moment the daily job may delete an account marked at `requestedAt`. */
export function deletionDueAt(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_GRACE_MS);
}

/** Accounts marked at or before this moment are due. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - DELETION_GRACE_MS);
}

export function isDeletionDue(requestedAt: Date | null, now: Date): boolean {
  return requestedAt !== null && requestedAt.getTime() <= purgeCutoff(now).getTime();
}

type Db = PrismaClient | Prisma.TransactionClient;

/** The partner link this user is part of (member → pool), or null. */
export async function partnerLinkOf(db: Db, userId: string): Promise<{ memberId: string; poolId: string } | null> {
  const mine = await db.userSettings.findUnique({ where: { userId }, select: { linkedUserId: true } });
  if (mine?.linkedUserId) return { memberId: userId, poolId: mine.linkedUserId };
  const partner = await db.userSettings.findFirst({ where: { linkedUserId: userId }, select: { userId: true } });
  return partner ? { memberId: partner.userId, poolId: userId } : null;
}

export interface PurgeDeps {
  now: Date;
  /** Null when banking isn't configured: sessions can't be revoked (logged). */
  banking: BankingProviderClient | null;
  /** Null when Stripe isn't configured. Cancels the subscription immediately. */
  cancelStripeSubscription: ((subscriptionId: string) => Promise<void>) | null;
  sendDeletedEmail: (email: string, name: string, locale: EmailLocale) => Promise<void>;
}

export type PurgeOutcome = "deleted" | "not_due" | "gone";

/** Purges one user if still due (see the header). Throws on a failure that
 *  must stop this user's purge; the caller logs it and moves on. */
export async function purgeUser(db: PrismaClient, userId: string, deps: PurgeDeps): Promise<PurgeOutcome> {
  const cutoff = purgeCutoff(deps.now);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true, name: true, deletionRequestedAt: true,
      settings: { select: { language: true } },
      subscription: { select: { stripeSubscriptionId: true } },
      householdMemberships: { select: { householdId: true } },
    },
  });
  if (!user) return "gone";
  if (!isDeletionDue(user.deletionRequestedAt, deps.now)) return "not_due";

  // a. Household.
  const link = await partnerLinkOf(db, userId);
  if (link) {
    const outcome = await db.$transaction(async (tx) => {
      await lockSettings(tx, [link.memberId, link.poolId]);
      // Still marked? A cancel waits on this lock or is seen here.
      const still = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} AND "deletionRequestedAt" <= ${cutoff} FOR UPDATE`;
      if (still.length === 0) return "not_due" as const;
      const current = await tx.userSettings.findUnique({ where: { userId: link.memberId }, select: { linkedUserId: true } });
      if (current?.linkedUserId === link.poolId) await unlinkMemberFromPool(tx, link);
      return "unlinked" as const;
    }, { timeout: 30_000 });
    if (outcome === "not_due") return "not_due";
  }

  // b. Bank sessions. After the unlink every connection she owns is in her scope.
  const connections = await db.bankConnection.findMany({
    where: { ownerUserId: userId, requisitionId: { not: "" } },
    select: { id: true, requisitionId: true },
  });
  for (const c of connections) {
    if (!deps.banking) {
      console.error(`[account/purge] connection ${c.id}: banking not configured, provider session not revoked`);
      continue;
    }
    try {
      await deps.banking.deleteSession(decrypt(c.requisitionId));
    } catch (err) {
      console.error(`[account/purge] connection ${c.id}: provider session not revoked: ${syncErrorCode(err)}`);
    }
    // Revoked or not, never try again: the row goes with the user below.
    await db.bankConnection.update({ where: { id: c.id }, data: { status: "revoked", requisitionId: "" } });
  }

  // c. Stripe.
  const subscriptionId = user.subscription?.stripeSubscriptionId;
  if (subscriptionId) {
    if (deps.cancelStripeSubscription) {
      await deps.cancelStripeSubscription(subscriptionId);
    } else {
      console.error(`[account/purge] user ${userId}: Stripe not configured, subscription not cancelled`);
    }
  }

  // d. The user and everything that cascades from her.
  const deleted = await db.user.deleteMany({ where: { id: userId, deletionRequestedAt: { not: null, lte: cutoff } } });
  if (deleted.count === 0) return "not_due";
  if (user.email) await db.otpToken.deleteMany({ where: { email: user.email } });
  const householdIds = user.householdMemberships.map(m => m.householdId);
  if (householdIds.length) {
    await db.household.deleteMany({ where: { id: { in: householdIds }, members: { none: {} } } });
  }

  // e. Goodbye email.
  if (user.email) {
    await deps.sendDeletedEmail(user.email, user.name ?? "", resolveLocale(user.settings?.language))
      .catch(err => console.error(`[account/purge] user ${userId}: deleted email failed:`, err instanceof Error ? err.message : "unknown error"));
  }
  return "deleted";
}

export interface PurgeSummary {
  deleted: number;
  failed: number;
}

/** Every due account, one at a time; one failure never stops the others. */
export async function runDeletionPurge(db: PrismaClient, deps: PurgeDeps): Promise<PurgeSummary> {
  const due = await db.user.findMany({
    where: { deletionRequestedAt: { not: null, lte: purgeCutoff(deps.now) } },
    orderBy: { deletionRequestedAt: "asc" },
    select: { id: true },
  });
  const summary: PurgeSummary = { deleted: 0, failed: 0 };
  for (const { id } of due) {
    try {
      if ((await purgeUser(db, id, deps)) === "deleted") summary.deleted++;
    } catch (err) {
      summary.failed++;
      console.error(`[account/purge] user ${id} failed:`, err instanceof Error ? err.message : "unknown error");
    }
  }
  return summary;
}
