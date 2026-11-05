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
// Purge of one user D, in short steps so no database transaction waits on
// the network:
//   1. Claim: a short transaction locks D's User row (mark still set and due)
//      and sets deletionStartedAt. From here a cancel answers 409.
//   2. Stripe (outside any transaction). Billing configured: the Stripe
//      customer is deleted, which also cancels any subscription at once. Not
//      configured: an account with a live subscription is skipped (retried
//      tomorrow, the claim released); without one, deletion goes on. If Stripe
//      fails, the claim is released and nothing else has happened.
//   3. Data: ONE short transaction that re-checks the claim, then
//      a. household, under lockSettings (as accept/unlink):
//         - debts of D that the survivor has movements on are kept and
//           re-owned to her (keepDebtsTheSurvivorUses): deleting them would
//           turn her payments into full-amount spending and leave her card
//           purchases on nothing, changing months already closed;
//         - the other cross-owner debt–account pairs are resolved so nothing
//           of D's stays inside the other person's data (resolveCrossOwnerPairs);
//         - D is the MEMBER: unlinkMemberFromPool moves her rows to her own
//           scope (server/lib/partnerUnlink.ts) and they go with her below;
//         - D OWNS the pool: the pool is handed to the partner (transferPool):
//           D's own rows — planUnlink's split, with D as the member — are
//           deleted, and every other pool row (budget lines, monthly budgets,
//           rules, recurring, ownerless plans and every deposit on them, shared
//           expenses, what the partner paid…) is re-keyed to the partner, who
//           becomes the household's owner;
//      b. rows D owns in any OTHER scope (left in a former pool by an old
//         cross-owner pair) get the same treatment, then go (sweepOwnedElsewhere);
//      c. everything else that points at D is erased (eraseReferences): her
//         shares on other people's expenses (folded into the other member's,
//         so the shares still add up), payer/beneficiary/creator ids, deposit
//         authorship, invites sent to her email, her one-time codes;
//      d. the user is deleted (every relation cascades), and households left
//         without members.
//      If it fails, it rolls back and the claim is released.
//   4. After the commit: her bank sessions are revoked at the provider (best
//      effort; a failure is logged, and the consent expires on its own within
//      180 days), and the "your account was deleted" email.
//
// A run stops starting new users after PURGE_BUDGET_MS (the function's limit
// is 60 s); the rest go the next day, oldest request first.
// Safe to run again: a user already gone is "gone", an unmarked one "not_due".
// Logs name a user only by id, as the rest of the server does, never by email.
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockSettings } from "./partnerLink.js";
import { loadUnlinkInput, planUnlink, unlinkMemberFromPool } from "./partnerUnlink.js";
import { namespacedExternalId } from "./partnerMerge.js";
import { debtState, inLedger, loadDebtLedgers } from "./debtBalance.js";
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

/** D's own movement: she paid it, or entered it with no payer recorded. */
export function isOwnMovement(e: { payerUserId: string | null; createdByUserId: string | null }, deletedId: string): boolean {
  return e.payerUserId === deletedId || (e.payerUserId === null && e.createdByUserId === deletedId);
}
const ownMovementWhere = (deletedId: string) => ({
  OR: [{ payerUserId: deletedId }, { payerUserId: null, createdByUserId: deletedId }],
});

/** Names for what the survivor inherits, in her language (the old ones may name D). */
const INHERITED_NAMES = {
  es: { card: "Tarjeta compartida", account: "Cuenta compartida", debt: "Deuda compartida" },
  en: { card: "Shared card", account: "Shared account", debt: "Shared debt" },
} as const;
async function inheritedNames(tx: Tx, survivorId: string) {
  const s = await tx.userSettings.findUnique({ where: { userId: survivorId }, select: { language: true } });
  return INHERITED_NAMES[resolveLocale(s?.language)];
}

/**
 * D's debts in `scope` that the survivor has movements on (payments, or
 * purchases on the debt's account) are kept: re-owned to `survivorId`, with
 * the account behind them when it is D's too, and renamed. Their movements —
 * D's included — stay, so every ledger and every month's counted spending
 * (debtBalance.ts, countedAmounts) is exactly what it was; D's attribution on
 * them is erased later (eraseReferences).
 */
export async function keepDebtsTheSurvivorUses(tx: Tx, scope: string, deletedId: string, survivorId: string): Promise<string[]> {
  const debts = await tx.debt.findMany({
    where: { userId: scope, ownerUserId: deletedId },
    select: { id: true, accountId: true, account: { select: { ownerUserId: true, type: true } } },
  });
  const kept: string[] = [];
  let names: (typeof INHERITED_NAMES)["es" | "en"] | null = null;
  for (const d of debts) {
    const survivorMoves = await tx.expense.count({
      where: {
        userId: scope,
        OR: [{ debtId: d.id }, ...(d.accountId ? [{ accountId: d.accountId, debtId: null }] : [])],
        NOT: ownMovementWhere(deletedId),
      },
    });
    if (survivorMoves === 0) continue;
    names ??= await inheritedNames(tx, survivorId);
    const accountIsHers = d.accountId !== null && d.account?.ownerUserId === deletedId;
    await tx.debt.update({
      where: { id: d.id },
      data: { ownerUserId: survivorId, name: d.account?.type === "card" ? names.card : names.debt },
    });
    if (accountIsHers) {
      await tx.account.update({
        where: { id: d.accountId! },
        data: { ownerUserId: survivorId, name: d.account!.type === "card" ? names.card : names.account },
      });
    }
    kept.push(d.id);
  }
  return kept;
}

export type PairAction = "reown_debt" | "delete_debt" | "freeze_debt";

/**
 * What to do with a debt–account pair whose two ends have different owners
 * when one of them (`deletedId`) is deleted. Pure. Runs after
 * keepDebtsTheSurvivorUses, so D's debts left here carry none of the
 * survivor's movements. The other person's end always survives, consistent:
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

/**
 * The anchor that keeps a debt's live balance when its account's purchases
 * stop feeding it from `at` on (pure). The new ledger, anchored at `at`, keeps
 * the adjustments dated from `at` on and the payments inLedger(…, at); every
 * purchase leaves, those dated from `at` on (D's future ones) for good. So
 * anchor = what the debt owed just before `at` (as debtState(ledger, at)),
 * computed so that a payment counted after the new anchor is never counted
 * twice, even on the anchor's own day.
 */
export function frozenAnchor(
  liveBalance: number,
  movements: { purchases: { amount: number; date: Date }[]; adjustments: { amount: number; date: Date }[] },
  payments: { amount: number; date: Date; createdAt: Date }[],
  at: Date,
): number {
  const sum = (xs: { amount: number }[]) => xs.reduce((s, m) => s + m.amount, 0);
  const futurePurchases = sum(movements.purchases.filter(m => m.date >= at));
  const keptAdjustments = sum(movements.adjustments.filter(m => m.date >= at));
  const keptPayments = sum(payments.filter(p => inLedger(p, at)));
  return liveBalance - futurePurchases - keptAdjustments + keptPayments;
}

async function freezeDebt(tx: Tx, scope: string, debtId: string, now: Date): Promise<void> {
  const [ledger] = await loadDebtLedgers(scope, [debtId], tx);
  if (!ledger) return;
  const payments = await tx.expense.findMany({
    where: { userId: scope, debtId, kind: { not: "refund" } },
    select: { amount: true, date: true, createdAt: true },
  });
  const anchor = frozenAnchor(debtState(ledger).balance, ledger, payments, now);
  await tx.debtAdjustment.deleteMany({ where: { debtId, date: { lt: now } } });
  await tx.debt.update({ where: { id: debtId }, data: { accountId: null, currentBalance: anchor, balanceAsOf: now } });
}

/** Applies pairAction to every cross-owner pair of `scope` involving `deletedId`. */
export async function resolveCrossOwnerPairs(tx: Tx, scope: string, deletedId: string, now: Date): Promise<void> {
  const debts = await tx.debt.findMany({
    where: { userId: scope, accountId: { not: null } },
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
      await freezeDebt(tx, scope, d.id, now);
    }
  }
}

/**
 * Rows D owns in scopes that aren't hers — left in a former pool by an old
 * cross-owner pair, with no link any more: kept for the scope's owner when she
 * uses them, pairs resolved, the rest deleted with D's own movements on them.
 */
export async function sweepOwnedElsewhere(tx: Tx, deletedId: string, now: Date): Promise<void> {
  const elsewhere = { ownerUserId: deletedId, userId: { not: deletedId } };
  const scopeRows = await Promise.all([
    tx.account.findMany({ where: elsewhere, select: { userId: true } }),
    tx.debt.findMany({ where: elsewhere, select: { userId: true } }),
    tx.income.findMany({ where: elsewhere, select: { userId: true } }),
    tx.bankConnection.findMany({ where: elsewhere, select: { userId: true } }),
  ]);
  const scopes = new Set(scopeRows.flat().map(r => r.userId));
  for (const scope of scopes) {
    await keepDebtsTheSurvivorUses(tx, scope, deletedId, scope);
    await resolveCrossOwnerPairs(tx, scope, deletedId, now);
    const mine = { userId: scope, ownerUserId: deletedId };
    const accounts = (await tx.account.findMany({ where: mine, select: { id: true } })).map(a => a.id);
    if (accounts.length) {
      // Her movements on her accounts go with them; a payment of someone
      // else's debt stays (it is that debt's ledger).
      await tx.expense.deleteMany({ where: { userId: scope, accountId: { in: accounts }, debtId: null, ...ownMovementWhere(deletedId) } });
    }
    const debts = (await tx.debt.findMany({ where: mine, select: { id: true } })).map(d => d.id);
    if (debts.length) await tx.allocation.deleteMany({ where: { debtId: { in: debts }, type: "debt" } });
    await tx.debt.deleteMany({ where: mine });
    await tx.income.deleteMany({ where: mine });
    await tx.account.deleteMany({ where: mine });
    await tx.bankConnection.deleteMany({ where: mine });
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
  /** Null when billing isn't configured. Deletes the Stripe customer, which
   *  also cancels its subscriptions at once; "already gone" counts as done. */
  deleteStripeCustomer: ((customerId: string) => Promise<void>) | null;
  sendDeletedEmail: (email: string, name: string, locale: EmailLocale) => Promise<void>;
}

export type PurgeOutcome = "deleted" | "not_due" | "gone" | "skipped";

/** Whether our Subscription row says a Stripe subscription may still charge. */
export function hasLiveSubscription(sub: { stripeSubscriptionId: string | null; status: string | null }): boolean {
  return sub.stripeSubscriptionId !== null && !["cancelled", "canceled", "incomplete_expired"].includes(sub.status ?? "");
}

const SHORT_TX = { timeout: 30_000, maxWait: 10_000 };

async function releaseClaim(db: PrismaClient, userId: string): Promise<void> {
  await db.user.updateMany({ where: { id: userId }, data: { deletionStartedAt: null } });
}

/** Purges one user if still due (see the header). Throws on a failure that
 *  stops this user's purge (claim released, nothing deleted); the caller logs it. */
export async function purgeUser(db: PrismaClient, userId: string, deps: PurgeDeps): Promise<PurgeOutcome> {
  const cutoff = purgeCutoff(deps.now);
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      email: true, name: true, deletionRequestedAt: true, settings: { select: { language: true } },
      subscription: { select: { stripeCustomerId: true, stripeSubscriptionId: true, status: true } },
    },
  });
  if (!user) return "gone";
  if (!isDeletionDue(user.deletionRequestedAt, deps.now)) return "not_due";

  // 1. Claim.
  const claimed = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} AND "deletionRequestedAt" <= ${cutoff} FOR UPDATE`;
    if (rows.length === 0) return false;
    await tx.user.update({ where: { id: userId }, data: { deletionStartedAt: deps.now } });
    return true;
  }, SHORT_TX);
  if (!claimed) return "not_due";

  // 2. Stripe, before anything irreversible here. Deleting the customer can't
  //    be undone: if a later step fails, the account stays (still marked, the
  //    claim released) without its subscription. Acceptable — the person asked
  //    to delete it, and the next run retries ("already gone" is done).
  const sub = user.subscription;
  try {
    if (sub) {
      if (deps.deleteStripeCustomer) {
        await deps.deleteStripeCustomer(sub.stripeCustomerId);
      } else if (hasLiveSubscription(sub)) {
        console.error(`[account/purge] user ${userId}: live subscription and billing not configured, skipped until it can be cancelled`);
        await releaseClaim(db, userId);
        return "skipped";
      } else {
        console.error(`[account/purge] user ${userId}: billing not configured, the Stripe customer record is not deleted`);
      }
    }
  } catch (err) {
    await releaseClaim(db, userId);
    throw err;
  }

  // 3. Data.
  let sessions: { id: string; requisitionId: string }[] | null;
  try {
    sessions = await db.$transaction(async (tx) => {
      const still = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} AND "deletionRequestedAt" <= ${cutoff}
          AND "deletionStartedAt" IS NOT NULL FOR UPDATE`;
      if (still.length === 0) return null;

      // Read before the rows go; revoked after the commit.
      const toRevoke = await tx.bankConnection.findMany({
        where: { ownerUserId: userId, requisitionId: { not: "" } },
        select: { id: true, requisitionId: true },
      });

      // a. Household.
      const link = await partnerLinkOf(tx, userId);
      if (link) {
        await lockSettings(tx, [link.memberId, link.poolId]);
        const current = await tx.userSettings.findUnique({ where: { userId: link.memberId }, select: { linkedUserId: true } });
        if (current?.linkedUserId === link.poolId) {
          const survivor = link.memberId === userId ? link.poolId : link.memberId;
          await keepDebtsTheSurvivorUses(tx, link.poolId, userId, survivor);
          await resolveCrossOwnerPairs(tx, link.poolId, userId, deps.now);
          if (link.memberId === userId) await unlinkMemberFromPool(tx, link);
          else await transferPool(tx, { ownerId: userId, partnerId: link.memberId });
        }
      }
      // b. What she still owns elsewhere.
      await sweepOwnedElsewhere(tx, userId, deps.now);
      // c. References.
      await eraseReferences(tx, userId, user.email);
      // d. The user and emptied households.
      const memberships = await tx.householdMember.findMany({ where: { userId }, select: { householdId: true } });
      await tx.user.delete({ where: { id: userId } });
      if (memberships.length) {
        await tx.household.deleteMany({ where: { id: { in: memberships.map(m => m.householdId) }, members: { none: {} } } });
      }
      return toRevoke;
    }, SHORT_TX);
  } catch (err) {
    await releaseClaim(db, userId);
    throw err;
  }
  if (sessions === null) {
    await releaseClaim(db, userId);
    return "not_due";
  }

  // 4. After the commit: bank sessions (best effort) and the goodbye email.
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
  if (user.email) {
    await deps.sendDeletedEmail(user.email, user.name ?? "", resolveLocale(user.settings?.language))
      .catch(err => console.error(`[account/purge] user ${userId}: deleted email failed:`, err instanceof Error ? err.message : "unknown error"));
  }
  return "deleted";
}

/** Stop starting new users after this long: the function's maxDuration is
 *  60 s (vercel.json) and one user can wait on Stripe and the bank. */
export const PURGE_BUDGET_MS = 40_000;

export interface PurgeSummary {
  deleted: number;
  failed: number;
  skipped: number;
  /** Due users not started because the time budget ran out (next run). */
  remaining: number;
}

/** Every due account, oldest request first, one at a time; one failure never
 *  stops the others, and the time budget stops starting new ones. */
export async function runDeletionPurge(
  db: PrismaClient,
  deps: PurgeDeps,
  opts: { budgetMs?: number; clock?: () => number } = {},
): Promise<PurgeSummary> {
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? PURGE_BUDGET_MS;
  const due = await db.user.findMany({
    where: { deletionRequestedAt: { not: null, lte: purgeCutoff(deps.now) } },
    orderBy: { deletionRequestedAt: "asc" },
    select: { id: true },
  });
  const summary: PurgeSummary = { deleted: 0, failed: 0, skipped: 0, remaining: 0 };
  for (const [i, { id }] of due.entries()) {
    if (clock() - started >= budget) { summary.remaining = due.length - i; break; }
    try {
      const outcome = await purgeUser(db, id, deps);
      if (outcome === "deleted") summary.deleted++;
      else if (outcome === "skipped") summary.skipped++;
    } catch (err) {
      summary.failed++;
      console.error(`[account/purge] user ${id} failed:`, err instanceof Error ? err.message : "unknown error");
    }
  }
  return summary;
}
