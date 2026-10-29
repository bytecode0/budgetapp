// Bank movements through the epic-4 ingest core (docs/plan-deudas-y-onboarding.md §5.4).
//
//   provider txns (BOOKED only) ──toNormalizedRows──▶ NormalizedRow[]
//   ──prepareImport (classifyRows: card/account mode, card payments, dedup
//     against everything stored, file imports included)──▶ ImportPreview
//   ──review (first time, or flagged rows) / auto (clean rows, daily)──▶
//   confirmImport(source "bank_sync") — the same writes as a file import.
//
// Rules:
//  - Nothing is written for an account until the user reviewed its first sync
//    (Account.bankReviewedAt).
//  - The daily sync writes only CLEAN rows: new, an expense/income/payment/
//    refund the core is sure of, no warning, no possible duplicate, and an
//    expense only with a category from the user's rules. Anything else waits
//    for the user (Account.bankPendingReview); rows the user dismissed in a
//    review are never written (Account.bankDismissedIds).
//  - Account.bankReviewedAt is a cursor: movements before it are settled. The
//    sync reads from it (at most MAX_WINDOW_DAYS back) and moves it forward —
//    to OVERLAP_DAYS ago, for late bookings — only when nothing waits, so a
//    held movement stays in every window until the user decides.
//  - Categories come from the user's rules only (categorize.ts via
//    prepareImport): no merchant name goes to any AI here.
//  - A card account's balance is never written (it stays 0: what's owed lives
//    in its debt). The bank's booked balance reconciles the card's DEBT through
//    setLiveValues (a dated adjustment), and only when no movement of that card
//    is waiting for review — otherwise the adjustment would absorb a purchase
//    the user is about to confirm, and count it twice.
import { prisma } from "../prisma.js";
import { toCents } from "../money.js";
import { setLiveValues } from "../debtBalance.js";
import { decrypt } from "../crypto/secretBox.js";
import { prepareImport, type ImportPreview, type ImportRow } from "../importStatement.js";
import { confirmImport } from "../ingest/confirm.js";
import type { ConfirmRow } from "../ingest/writes.js";
import type { NormalizedRow } from "../../../shared/ingest/types.js";
import { EnableBankingError } from "./enableBanking.js";
import type { BankAccountKind, BankingProviderClient, BankProviderTxn } from "./types.js";

export const PROVIDER = "enablebanking";
/** History read for the first review. */
export const FIRST_SYNC_DAYS = 90;
/** The cursor stays this many days behind: banks book late. */
export const OVERLAP_DAYS = 7;
/** Banks usually give 90 days of history without the user present. */
export const MAX_WINDOW_DAYS = 89;
/** Dismissed ids kept per account (newest). */
export const MAX_DISMISSED_IDS = 2000;

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The id a provider movement is deduplicated by — namespaced, so it can never
 *  collide with another source's id. classify.ts hashes it with the account. */
export function externalRefFor(providerTxnId: string): string {
  return `${PROVIDER}:${providerTxnId}`;
}

/** Provider movements → the ingest core's rows. A movement without a provider
 *  id gets no externalRef: the core then fingerprints it by content (day,
 *  amount, merchant, running balance or occurrence), stable across syncs. */
export function toNormalizedRows(txns: BankProviderTxn[]): NormalizedRow[] {
  return txns.map((t, i) => ({
    rowIndex: i,
    date: t.date,
    amountCents: t.amountCents,
    description: t.description,
    ...(t.details ? { details: t.details } : {}),
    balanceCents: t.balanceAfterCents ?? null,
    externalRef: t.id ? externalRefFor(t.id) : null,
    currency: t.currency,
  }));
}

const AUTO_KINDS = new Set(["expense", "income", "payment", "refund"]);

/** Whether the daily sync may write a preview row without the user. An
 *  expense needs a rule category: one nobody recognised may well be a card
 *  payment the wording didn't reveal, and counting it as spending would
 *  count the card's purchases twice. */
export function autoWritable(row: ImportRow): boolean {
  return row.status === "new"
    && AUTO_KINDS.has(row.kind)
    && !row.possibleDuplicate
    && !row.learnedPayment
    && (row.warnings ?? []).length === 0
    && !(row.kind === "expense" && !row.suggestedAllocationId);
}

/** Rows the user must look at: new, not clean, not dismissed before. */
export function heldForReview(rows: ImportRow[]): number {
  return rows.filter(r => r.status === "new" && !autoWritable(r)).length;
}

/** The stored dismissed ids (Json column), tolerant of anything odd in it. */
export function dismissedSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
}

/** Adds newly dismissed ids, newest kept, capped. */
export function mergeDismissed(stored: unknown, added: unknown): string[] {
  const fresh = Array.isArray(added) ? added.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200) : [];
  const all = [...dismissedSet(stored)].filter(id => !fresh.includes(id)).concat(fresh);
  return all.slice(-MAX_DISMISSED_IDS);
}

/** A preview without the movements the user already dismissed. */
export function withoutDismissed<T extends { rows: ImportRow[]; newCount: number }>(preview: T, dismissed: Set<string>): T {
  if (dismissed.size === 0) return preview;
  const rows = preview.rows.filter(r => !(r.status === "new" && dismissed.has(r.externalId)));
  return { ...preview, rows, newCount: rows.filter(r => r.status === "new").length };
}

/** A clean preview row as the confirm writes it (rule category, or the debt it pays). */
export function toConfirmRow(row: ImportRow): ConfirmRow {
  return {
    kind: row.kind,
    externalId: row.externalId,
    date: row.date,
    description: row.description,
    merchant: row.merchant,
    amountCents: toCents(row.amount),
    allocationId: row.kind === "expense" || row.kind === "refund" ? row.suggestedAllocationId : null,
    debtId: row.kind === "payment" ? row.debtId ?? null : null,
  };
}

/** First day read, for the daily sync and the review alike: FIRST_SYNC_DAYS
 *  back the first time; then the cursor, never more than MAX_WINDOW_DAYS. */
export function bankWindowFrom(account: { bankReviewedAt: Date | null }, now: Date): string {
  if (!account.bankReviewedAt) return isoDay(new Date(now.getTime() - FIRST_SYNC_DAYS * DAY_MS));
  const cursor = isoDay(account.bankReviewedAt);
  const oldest = isoDay(new Date(now.getTime() - MAX_WINDOW_DAYS * DAY_MS));
  return cursor > oldest ? cursor : oldest;
}

/** Where the cursor goes once nothing waits: OVERLAP_DAYS ago, never back. */
export function advancedCursor(current: Date | null, now: Date): Date {
  const next = new Date(now.getTime() - OVERLAP_DAYS * DAY_MS);
  return current && current > next ? current : next;
}

/** How a card's bank balance is signed. Enable Banking's balances carry no
 *  credit/debit indicator, so it's read from the card's own movements: their
 *  running balance (balance_after_transaction) moves with the holder's view
 *  (a purchase lowers it → negative = owed) or against it (positive = owed).
 *  Null when the movements don't say, or contradict each other. */
export type CardBalanceConvention = "negative_owed" | "positive_owed";

export function cardBalanceConvention(txns: BankProviderTxn[]): CardBalanceConvention | null {
  let withHolder = 0, against = 0;
  // Pairs of neighbours in the provider's order, either way round (banks
  // list oldest or newest first): the later balance minus the earlier one is
  // ± the later movement.
  for (let i = 1; i < txns.length; i++) {
    const a = txns[i - 1], b = txns[i];
    if (a.balanceAfterCents == null || b.balanceAfterCents == null) continue;
    for (const [earlier, later] of [[a, b], [b, a]] as const) {
      const delta = later.balanceAfterCents! - earlier.balanceAfterCents!;
      if (delta === 0 || later.amountCents === 0) continue;
      if (delta === later.amountCents) withHolder++;
      else if (delta === -later.amountCents) against++;
    }
  }
  if (withHolder >= 2 && against === 0) return "negative_owed";
  if (against >= 2 && withHolder === 0) return "positive_owed";
  return null;
}

/** What a card's balance says is owed, never negative: a card in credit owes
 *  0. With no convention known, a negative balance is a debit (ISO 20022)
 *  and a positive one is ambiguous — owed or in credit — so null: don't touch
 *  the debt on a guess. */
export function owedFromCardBalance(amountCents: number, convention: CardBalanceConvention | null): number | null {
  if (amountCents === 0) return 0;
  if (convention === "positive_owed") return Math.max(amountCents, 0);
  if (convention === "negative_owed") return Math.max(-amountCents, 0);
  return amountCents < 0 ? -amountCents : null;
}

/** A bank balance can reconcile a card's debt only when it already includes
 *  the latest movement recorded for that card (no reference date: current). */
export function balanceIsCurrent(balance: { referenceDate?: string }, latestMovementDay: string | null): boolean {
  return !balance.referenceDate || !latestMovementDay || balance.referenceDate >= latestMovementDay;
}

/** Day of the latest movement recorded for a card: purchases on its account
 *  or payments of its debt. */
export async function latestCardMovementDay(userId: string, accountId: string, debtId: string | null): Promise<string | null> {
  const latest = await prisma.expense.findFirst({
    where: { userId, OR: [{ accountId }, ...(debtId ? [{ debtId }] : [])] },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return latest ? isoDay(latest.date) : null;
}

export interface LinkedAccount {
  id: string;
  type: string;
  externalAccountId: string | null;
  bankReviewedAt: Date | null;
  bankDismissedIds?: unknown;
  bankPendingReview?: number;
}

interface ConnectionCtx {
  id: string;
  userId: string;
  ownerUserId: string;
}

/** The preview of an account's bank movements since `dateFrom` (euros, like
 *  /api/expenses/import/preview). The provider's credit/debit indicator gives
 *  the holder's view, so a card's sign is known: no sign question. */
export async function previewBankAccount(
  client: BankingProviderClient,
  connection: ConnectionCtx,
  account: LinkedAccount,
  dateFrom: string,
): Promise<ImportPreview & { pendingCount: number; cardConvention: CardBalanceConvention | null }> {
  const txns = await client.getAccountTransactions(account.externalAccountId!, dateFrom);
  const preview = await prepareImport(connection.userId, {
    accountId: account.id,
    rows: toNormalizedRows(txns.booked),
    purchasesSign: "negative",
  });
  const { purchasesSign: _sign, purchasesSignDetected: _detected, skipped: _skipped, source: _source, ...rest } = preview;
  const cardConvention = account.type === "card" ? cardBalanceConvention(txns.booked) : null;
  return withoutDismissed({ ...rest, pendingCount: txns.pendingCount, cardConvention }, dismissedSet(account.bankDismissedIds));
}

const kindOf = (account: { type: string }): BankAccountKind => (account.type === "card" ? "card" : account.type === "savings" ? "savings" : "checking");

/** Brings an account's (or card debt's) balance in line with the bank. A
 *  card's debt only when the balance is current and its sign is clear; the
 *  read and the adjustment run under a row lock on the debt, so two syncs at
 *  once (cron, "sync now", a review) can't both add the same correction. */
export async function refreshBalance(
  client: BankingProviderClient,
  connection: ConnectionCtx,
  account: LinkedAccount,
  convention: CardBalanceConvention | null = null,
): Promise<void> {
  const balance = await client.getAccountBalance(account.externalAccountId!, kindOf(account));
  if (!balance) return;
  const now = new Date();
  if (account.type !== "card") {
    await prisma.account.update({
      where: { id: account.id },
      data: { currentBalance: balance.amountCents, balanceSource: "bank_sync", balanceSyncedAt: now },
    });
    return;
  }
  const debt = await prisma.debt.findFirst({
    where: { userId: connection.userId, accountId: account.id, kind: "credit_card" },
    select: { id: true },
  });
  if (!debt) return;
  if (!balanceIsCurrent(balance, await latestCardMovementDay(connection.userId, account.id, debt.id))) {
    console.warn(`[banking/sync] card ${account.id}: bank balance older than its latest movement, debt left as is`);
    return;
  }
  const owed = owedFromCardBalance(balance.amountCents, convention);
  if (owed === null) {
    console.warn(`[banking/sync] card ${account.id}: balance sign unclear, debt left as is`);
    return;
  }
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Debt" WHERE "id" = ${debt.id} FOR UPDATE`;
    await setLiveValues(connection.userId, debt.id, { balance: owed }, tx);
    await tx.debt.update({ where: { id: debt.id }, data: { balanceSource: "bank_sync", balanceSyncedAt: now } });
  }, { timeout: 20_000 });
}

/** The active household of a person (attribution of what they import). */
export async function householdOf(userId: string): Promise<string | null> {
  const membership = await prisma.householdMember.findFirst({ where: { userId, status: "active" }, select: { householdId: true } });
  return membership?.householdId ?? null;
}

export interface AccountSyncResult { written: number; held: number }

/** One reviewed account: clean rows written, the rest counted for review,
 *  then the balance (a card's only when nothing waits). */
export async function syncAccount(
  client: BankingProviderClient,
  connection: ConnectionCtx,
  account: LinkedAccount & { bankReviewedAt: Date },
  householdId: string | null,
  now: Date,
): Promise<AccountSyncResult> {
  const windowFrom = bankWindowFrom(account, now);
  // The cursor is pinned (something waits for review) further back than the
  // bank gives history: what waited before the window can't be fetched again.
  const heldExpired = isoDay(account.bankReviewedAt) < windowFrom && (account.bankPendingReview ?? 0) > 0;
  const preview = await previewBankAccount(client, connection, account, windowFrom);
  const clean = preview.rows.filter(autoWritable).map(toConfirmRow);
  let written = 0;
  if (clean.length > 0) {
    const result = await confirmImport(
      { userId: connection.userId, authUserId: connection.ownerUserId, householdId, accountId: account.id, source: "bank_sync" },
      clean,
    );
    if ("error" in result) throw new Error(`bank sync write rejected: ${result.code ?? result.error}`);
    written = result.inserted;
  }
  const held = heldForReview(preview.rows);
  if (heldExpired) {
    // Counts only, no personal data.
    console.warn(`[banking/sync] account ${account.id}: held movements before ${windowFrom} are too old to fetch (held before: ${account.bankPendingReview ?? 0}, now: ${held})`);
  }
  await prisma.account.update({
    where: { id: account.id },
    data: {
      bankPendingReview: held,
      ...(heldExpired && { bankSyncNotice: "held_expired", bankReviewedAt: new Date(`${windowFrom}T00:00:00Z`) }),
      ...(held === 0 && { bankReviewedAt: advancedCursor(heldExpired ? new Date(`${windowFrom}T00:00:00Z`) : account.bankReviewedAt, now) }),
    },
  });
  if (account.type !== "card" || held === 0) await refreshBalance(client, connection, account, preview.cardConvention);
  return { written, held };
}

export const SYNCABLE_STATUSES = ["active", "error"];

export interface SyncResult {
  ok: boolean;
  /** Stopped at the time budget before every account was synced. */
  partial?: boolean;
  written: number;
  held: number;
  /** Linked accounts whose first sync the user hasn't reviewed yet. */
  awaitingFirstReview: number;
  /** Machine code when !ok: "expired" | "not_active" | "provider_<status>[_<CODE>]" | "failed". */
  error?: string;
}

/** A short code for lastSyncError: never a message, which could carry data. */
export function syncErrorCode(err: unknown): string {
  if (err instanceof EnableBankingError) return `provider_${err.status}${err.providerCode ? `_${err.providerCode}` : ""}`;
  return "failed";
}

/** Syncs every linked, reviewed account of a connection. Errors are caught
 *  and recorded on the connection; a consent the bank no longer honours
 *  marks it expired (the fix is reconnecting, not retrying). */
export async function syncConnection(
  client: BankingProviderClient,
  connectionId: string,
  now = new Date(),
  /** Don't start another account after this (clock ms). */
  deadline?: { at: number; clock: () => number },
): Promise<SyncResult> {
  const empty = { written: 0, held: 0, awaitingFirstReview: 0 };
  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    include: { accounts: { where: { externalAccountId: { not: null } } } },
  });
  // "error" is retried (a provider hiccup); expired/revoked/pending are not.
  if (!connection || !SYNCABLE_STATUSES.includes(connection.status)) return { ok: false, ...empty, error: "not_active" };
  if (connection.expiresAt && connection.expiresAt <= now) {
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: "expired", lastSyncError: "expired" } });
    return { ok: false, ...empty, error: "expired" };
  }

  await prisma.bankConnection.update({ where: { id: connection.id }, data: { lastAttemptAt: now } });
  const householdId = await householdOf(connection.ownerUserId);
  const result = { ...empty };
  // One failing account never stops the others.
  let firstError: unknown = null;
  let partial = false;
  for (const account of connection.accounts) {
    if (!account.bankReviewedAt) { result.awaitingFirstReview++; continue; }
    if (deadline && deadline.clock() >= deadline.at) { partial = true; break; }
    try {
      const r = await syncAccount(client, connection, { ...account, bankReviewedAt: account.bankReviewedAt }, householdId, now);
      result.written += r.written;
      result.held += r.held;
    } catch (err) {
      firstError ??= err;
      console.error(`[banking/sync] account ${account.id} of connection ${connection.id} failed: ${syncErrorCode(err)}`);
    }
  }
  if (!firstError) {
    // A partial run isn't a sync: lastSyncedAt stays, the rest goes next time.
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "active", lastSyncError: null, ...(!partial && { lastSyncedAt: now }) },
    });
    return { ok: true, ...result, ...(partial && { partial }) };
  }
  {
    const err = firstError;
    const code = syncErrorCode(err);
    let expired = false;
    if (err instanceof EnableBankingError && [401, 403, 404, 422].includes(err.status) && connection.requisitionId) {
      // Ask the provider whether the consent itself is gone (expired, revoked
      // at the bank…) before calling it an error.
      try {
        expired = !(await client.getSession(decrypt(connection.requisitionId))).authorized;
      } catch { /* keep "error" */ }
    }
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: expired ? "expired" : "error", lastSyncError: expired ? "expired" : code },
    });
    console.error(`[banking/sync] connection ${connection.id} failed: ${code}`);
    return { ok: false, ...result, error: expired ? "expired" : code };
  }
}
