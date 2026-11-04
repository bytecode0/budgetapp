// Deleting an account (LPBETA-09), with 24 hours to change your mind.
//
//   1. Request (POST /api/account/deletion, with an email code): marks
//      User.deletionRequestedAt and emails a "cancel" link that opens the app.
//   2. Cancel (DELETE /api/account/deletion, signed in): clears the mark —
//      refused with 409 while a purge of that user is running (see below).
//   3. Purge (the daily job, GET /api/account/cron with CRON_SECRET): every
//      account marked more than 24 h ago is deleted. One run a day, so an
//      account goes 24–48 h after the request.
//
// Purge of one user D: ONE database transaction that starts by locking D's
// User row with the mark still set (the "purging" claim: a concurrent cancel
// can't take that lock and answers 409; a cancel that got there first leaves
// nothing to claim). Inside it, in this order:
//   a. Stripe (only when configured): cancel the subscription now. It goes
//      first: if Stripe fails, the transaction rolls back before anything
//      irreversible and tomorrow's run tries again.
//   b. Household, under lockSettings (as accept/unlink):
//      - cross-owner debt–account pairs involving D are resolved first, so
//        nothing of D's survives inside the other person's data
//        (resolveCrossOwnerPairs);
//      - D is the MEMBER: unlinkMemberFromPool moves her rows to her own
//        scope (server/lib/partnerUnlink.ts) and they go with her below;
//      - D OWNS the pool: the pool is handed to the partner (transferPool):
//        D's own rows — planUnlink's split, with D as the member — are
//        deleted, and every other pool row (budget lines, monthly budgets,
//        rules, recurring, ownerless plans and every deposit on them, shared
//        expenses, what the partner paid…) is re-keyed to the partner, who
//        becomes the household's owner.
//   c. Everything else that points at D is erased (eraseReferences): her
//      shares on other people's expenses (folded into the other member's, so
//      the shares still add up), payer/beneficiary/creator ids, deposit
//      authorship, invites sent to her email, her one-time codes.
//   d. The user is deleted (every relation cascades), and households left
//      without members.
//   e. Her bank sessions are revoked at the provider (best effort, as
//      DELETE /api/banking/connections/:id; never undone by a rollback, so
//      done last before commit).
// After the commit, the "your account was deleted" email (a failure is logged).
//
// Safe to run again: a user already gone is "gone", an unmarked one "not_due".
// Logs name a user only by id, as the rest of the server does, never by email.
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockSettings } from "./partnerLink.js";
import { loadUnlinkInput, planUnlink, unlinkMemberFromPool } from "./partnerUnlink.js";
import { namespacedExternalId } from "./partnerMerge.js";
import { debtState, loadDebtLedgers } from "./debtBalance.js";
import { decrypt } from "./crypto/secretBox.js";
import { syncErrorCode } from "./banking/sync.js";
import type { BankingProviderClient } from "./banking/types.js";
import { resolveLocale, type EmailLocale } from "./email/locales/index.js";

export const DELETION_GRACE_MS = 24 * 60 * 60 * 1000;
/** Postgres "lock_not_available": what a NOWAIT lock raises while a purge holds the row. */
export const LOCK_NOT_AVAILABLE = "55P03";

/** Whether a Prisma error is Postgres' lock_not_available (a NOWAIT lock on a held row). */
export function isLockNotAvailable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string } | null;
  return e?.meta?.code === LOCK_NOT_AVAILABLE || e?.code === LOCK_NOT_AVAILABLE || /55P03|could not obtain lock/.test(e?.message ?? "");
}

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
type Tx = Prisma.TransactionClient;

/** The partner link this user is part of (member → pool), or null. */
export async function partnerLinkOf(db: Db, userId: string): Promise<{ memberId: string; poolId: string } | null> {
  const mine = await db.userSettings.findUnique({ where: { userId }, select: { linkedUserId: true } });
  if (mine?.linkedUserId) return { memberId: userId, poolId: mine.linkedUserId };
  const partner = await db.userSettings.findFirst({ where: { linkedUserId: userId }, select: { userId: true } });
  return partner ? { memberId: partner.userId, poolId: userId } : null;
}

// Postgres caps bind parameters per statement.
const CHUNK = 5000;
async function inChunks(ids: string[], run: (chunk: string[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < ids.length; i += CHUNK) await run(ids.slice(i, i + CHUNK));
}

export type PairAction = "reown_debt" | "delete_debt" | "freeze_debt";

/**
 * What to do with a debt–account pair whose two ends have different owners
 * when one of them (`deletedId`) is deleted. Pure. The other person's end
 * always survives, consistent:
 *   - D's debt on the other's CARD: a card's debt belongs to the card's owner
 *     (server/lib/cardDebt.ts), so it is re-owned to her;
 *   - D's debt on the other's non-card account: deleted with D;
 *   - the other's debt on D's account: frozen at its live balance and
 *     detached, since D's account and its purchases go.
 * Null when the pair doesn't involve D or isn't cross-owner.
 */
export function pairAction(
  pair: { debtOwner: string; accountOwner: string; accountType: string },
  deletedId: string,
): PairAction | null {
  if (pair.debtOwner === pair.accountOwner) return null;
  if (pair.debtOwner === deletedId) return pair.accountType === "card" ? "reown_debt" : "delete_debt";
  if (pair.accountOwner === deletedId) return "freeze_debt";
  return null;
}

/** Applies pairAction to every cross-owner pair of `poolId` involving `deletedId`. */
export async function resolveCrossOwnerPairs(tx: Tx, poolId: string, deletedId: string, now: Date): Promise<void> {
  const debts = await tx.debt.findMany({
    where: { userId: poolId, accountId: { not: null } },
    select: { id: true, ownerUserId: true, account: { select: { ownerUserId: true, type: true } } },
  });
  for (const d of debts) {
    if (!d.account) continue;
    const action = pairAction({ debtOwner: d.ownerUserId, accountOwner: d.account.ownerUserId, accountType: d.account.type }, deletedId);
    if (action === "reown_debt") {
      await tx.debt.update({ where: { id: d.id }, data: { ownerUserId: d.account.ownerUserId } });
    } else if (action === "delete_debt") {
      await tx.allocation.deleteMany({ where: { debtId: d.id, type: "debt" } }); // its budget line
      await tx.debt.delete({ where: { id: d.id } });
    } else if (action === "freeze_debt") {
      // Live balance becomes the anchor as of now; adjustments are in it.
      const [ledger] = await loadDebtLedgers(poolId, [d.id], tx);
      const balance = ledger ? debtState(ledger).balance : 0;
      await tx.debtAdjustment.deleteMany({ where: { debtId: d.id } });
      await tx.debt.update({ where: { id: d.id }, data: { accountId: null, currentBalance: balance, balanceAsOf: now } });
    }
  }
}

/** Pool rows whose externalId the partner already has: a namespaced id free on both sides. Pure. */
export function clashRenames(
  namespaceId: string,
  hers: { externalId: string | null }[],
  pool: { id: string; externalId: string | null }[],
): { id: string; externalId: string }[] {
  const herIds = new Set(hers.map(r => r.externalId).filter((x): x is string => x !== null));
  const taken = new Set([...herIds, ...pool.map(r => r.externalId).filter((x): x is string => x !== null)]);
  return pool
    .filter(r => r.externalId !== null && herIds.has(r.externalId))
    .map(r => ({ id: r.id, externalId: namespacedExternalId(namespaceId, r.externalId!, taken) }));
}

/**
 * Hands the pool of `ownerId` (being deleted) to `partnerId`, the member
 * linked to it: deletes the owner's own rows and re-keys the rest to the
 * partner. Call with lockSettings held, after resolveCrossOwnerPairs.
 */
export async function transferPool(tx: Tx, ctx: { ownerId: string; partnerId: string }): Promise<void> {
  const { ownerId, partnerId } = ctx;
  // The owner's own rows: what the unlink would give the owner if HE were the
  // member leaving the pool — except what the partner paid, which stays hers.
  const own = planUnlink(await loadUnlinkInput(tx, ownerId, ownerId)).move;
  const paidByPartner = new Set((await tx.expense.findMany({
    where: { userId: ownerId, payerUserId: partnerId }, select: { id: true },
  })).map(e => e.id));
  const ownExpenses = own.expenseIds.filter(id => !paidByPartner.has(id));

  const del = <T>(ids: string[], run: (chunk: string[]) => Promise<T>) => inChunks(ids, run);
  await del(own.ruleIds, ids => tx.categorizationRule.deleteMany({ where: { id: { in: ids } } }));
  await del(own.allocationIds, ids => tx.allocation.deleteMany({ where: { id: { in: ids } } }));
  await del(own.planIds, ids => tx.lifePlan.deleteMany({ where: { id: { in: ids } } }));
  await del(ownExpenses, ids => tx.expense.deleteMany({ where: { id: { in: ids } } }));
  await del(own.incomeIds, ids => tx.income.deleteMany({ where: { id: { in: ids } } }));
  await del(own.debtIds, ids => tx.debt.deleteMany({ where: { id: { in: ids } } }));
  await del(own.accountIds, ids => tx.account.deleteMany({ where: { id: { in: ids } } }));
  await del(own.bankConnectionIds, ids => tx.bankConnection.deleteMany({ where: { id: { in: ids } } }));

  // Unique keys the partner may already hold in her own scope.
  const pool = { userId: ownerId };
  const hers = { userId: partnerId };
  const withExternalId = { externalId: { not: null } };
  const idSelect = { id: true, externalId: true } as const;
  const renames = [
    clashRenames(ownerId,
      await tx.expense.findMany({ where: { ...hers, ...withExternalId }, select: idSelect }),
      await tx.expense.findMany({ where: { ...pool, ...withExternalId }, select: idSelect })),
    clashRenames(ownerId,
      await tx.income.findMany({ where: { ...hers, ...withExternalId }, select: idSelect }),
      await tx.income.findMany({ where: { ...pool, ...withExternalId }, select: idSelect })),
  ];
  for (const r of renames[0]) await tx.expense.update({ where: { id: r.id }, data: { externalId: r.externalId } });
  for (const r of renames[1]) await tx.income.update({ where: { id: r.id }, data: { externalId: r.externalId } });
  const herRules = new Set((await tx.categorizationRule.findMany({ where: hers, select: { matchType: true, pattern: true } }))
    .map(r => `${r.matchType}|${r.pattern}`));
  const poolRules = await tx.categorizationRule.findMany({ where: pool, select: { id: true, matchType: true, pattern: true } });
  const dupRules = poolRules.filter(r => herRules.has(`${r.matchType}|${r.pattern}`)).map(r => r.id);
  if (dupRules.length) await tx.categorizationRule.deleteMany({ where: { id: { in: dupRules } } });
  const herMerchants = (await tx.recurringCommitment.findMany({ where: hers, select: { merchant: true } })).map(r => r.merchant);
  if (herMerchants.length) await tx.recurringCommitment.deleteMany({ where: { ...pool, merchant: { in: herMerchants } } });

  // Everything left in the pool is hers now.
  const toHer = { userId: partnerId };
  await tx.bankConnection.updateMany({ where: pool, data: toHer });
  await tx.account.updateMany({ where: pool, data: toHer });
  await tx.debt.updateMany({ where: pool, data: toHer });
  await tx.debtAdjustment.updateMany({ where: pool, data: toHer });
  await tx.income.updateMany({ where: pool, data: toHer });
  await tx.expense.updateMany({ where: pool, data: toHer });
  await tx.lifePlan.updateMany({ where: pool, data: toHer });
  await tx.planDeposit.updateMany({ where: pool, data: toHer });
  await tx.allocation.updateMany({ where: pool, data: toHer });
  await tx.monthlyBudget.updateMany({ where: pool, data: toHer });
  await tx.categorizationRule.updateMany({ where: pool, data: toHer });
  await tx.recurringCommitment.updateMany({ where: pool, data: toHer });
  await tx.duplicateDismissal.updateMany({ where: pool, data: toHer });

  // Her scope works like the pool did: same budget period, no link.
  const ownerSettings = await tx.userSettings.findUnique({ where: { userId: ownerId }, select: { cycleStartDay: true } });
  await tx.userSettings.update({
    where: { userId: partnerId },
    data: { linkedUserId: null, ...(ownerSettings && { cycleStartDay: ownerSettings.cycleStartDay }) },
  });

  // She owns the household; its name no longer carries his.
  const ownerHouseholds = await tx.householdMember.findMany({ where: { userId: ownerId, role: "owner" }, select: { householdId: true } });
  const partner = await tx.user.findUnique({ where: { id: partnerId }, select: { name: true } });
  for (const { householdId } of ownerHouseholds) {
    const updated = await tx.householdMember.updateMany({ where: { householdId, userId: partnerId }, data: { role: "owner", status: "active" } });
    if (updated.count > 0) {
      await tx.household.update({ where: { id: householdId }, data: { name: partner?.name ? `Hogar de ${partner.name}` : "Mi hogar" } });
    }
  }
}

/** Clears every reference to `userId` left in other people's rows (see the header, step c). */
export async function eraseReferences(tx: Tx, userId: string, email: string | null): Promise<void> {
  // Her shares on expenses that aren't hers: fold each into another member's
  // share (or the pool owner's), so Σ shares still equals the amount.
  const shares = await tx.expenseShare.findMany({
    where: { userId, expense: { userId: { not: userId } } },
    select: { id: true, amount: true, expenseId: true, expense: { select: { userId: true, shares: { select: { id: true, userId: true } } } } },
  });
  for (const s of shares) {
    const other = s.expense.shares.find(x => x.userId !== userId);
    if (other) {
      await tx.expenseShare.update({ where: { id: other.id }, data: { amount: { increment: s.amount } } });
      await tx.expenseShare.delete({ where: { id: s.id } });
    } else {
      await tx.expenseShare.update({ where: { id: s.id }, data: { userId: s.expense.userId } });
    }
  }
  await tx.expense.updateMany({ where: { payerUserId: userId }, data: { payerUserId: null } });
  await tx.expense.updateMany({ where: { beneficiaryUserId: userId }, data: { beneficiaryUserId: null } });
  await tx.expense.updateMany({ where: { createdByUserId: userId }, data: { createdByUserId: null } });
  await tx.planDeposit.updateMany({ where: { byUserId: userId }, data: { byUserId: null } });
  await tx.lifePlan.updateMany({ where: { ownerUserId: userId, userId: { not: userId } }, data: { ownerUserId: null } });
  if (email) {
    await tx.partnerInvite.deleteMany({ where: { invitedEmail: { equals: email, mode: "insensitive" } } });
    await tx.otpToken.deleteMany({ where: { email } });
  }
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

/** The purge's transaction may wait on Stripe and the bank provider. */
const PURGE_TX = { timeout: 50_000, maxWait: 10_000 };

/** Purges one user if still due (see the header). Throws on a failure that
 *  must stop this user's purge (everything rolls back); the caller logs it. */
export async function purgeUser(db: PrismaClient, userId: string, deps: PurgeDeps): Promise<PurgeOutcome> {
  const cutoff = purgeCutoff(deps.now);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, deletionRequestedAt: true, settings: { select: { language: true } } },
  });
  if (!user) return "gone";
  if (!isDeletionDue(user.deletionRequestedAt, deps.now)) return "not_due";

  const outcome = await db.$transaction(async (tx): Promise<PurgeOutcome> => {
    // The claim: held until commit. A cancel meanwhile gets 409.
    const claimed = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} AND "deletionRequestedAt" <= ${cutoff} FOR UPDATE`;
    if (claimed.length === 0) return "not_due";

    // a. Stripe, before anything irreversible.
    const subscription = await tx.subscription.findUnique({ where: { userId }, select: { stripeSubscriptionId: true } });
    if (subscription?.stripeSubscriptionId) {
      if (deps.cancelStripeSubscription) await deps.cancelStripeSubscription(subscription.stripeSubscriptionId);
      else console.error(`[account/purge] user ${userId}: Stripe not configured, subscription not cancelled`);
    }

    // Her bank sessions, read before the rows go (revoked in step e).
    const sessions = await tx.bankConnection.findMany({
      where: { ownerUserId: userId, requisitionId: { not: "" } },
      select: { id: true, requisitionId: true },
    });

    // b. Household.
    const link = await partnerLinkOf(tx, userId);
    if (link) {
      await lockSettings(tx, [link.memberId, link.poolId]);
      const current = await tx.userSettings.findUnique({ where: { userId: link.memberId }, select: { linkedUserId: true } });
      if (current?.linkedUserId === link.poolId) {
        await resolveCrossOwnerPairs(tx, link.poolId, userId, deps.now);
        if (link.memberId === userId) await unlinkMemberFromPool(tx, link);
        else await transferPool(tx, { ownerId: userId, partnerId: link.memberId });
      }
    }

    // c. References elsewhere.
    await eraseReferences(tx, userId, user.email);

    // d. The user (everything of hers cascades) and emptied households.
    const memberships = await tx.householdMember.findMany({ where: { userId }, select: { householdId: true } });
    await tx.user.delete({ where: { id: userId } });
    if (memberships.length) {
      await tx.household.deleteMany({ where: { id: { in: memberships.map(m => m.householdId) }, members: { none: {} } } });
    }

    // e. Bank sessions, best effort.
    for (const c of sessions) {
      if (!deps.banking) {
        console.error(`[account/purge] connection ${c.id}: banking not configured, provider session not revoked`);
        continue;
      }
      try {
        await deps.banking.deleteSession(decrypt(c.requisitionId));
      } catch (err) {
        console.error(`[account/purge] connection ${c.id}: provider session not revoked: ${syncErrorCode(err)}`);
      }
    }
    return "deleted";
  }, PURGE_TX);
  if (outcome !== "deleted") return outcome;

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
