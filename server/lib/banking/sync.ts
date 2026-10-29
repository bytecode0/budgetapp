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
//    refund the core is sure of, no warning, no possible duplicate. Anything
//    else waits for the user (Account.bankPendingReview).
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
/** Later syncs re-read this many days before the last one: banks book late. */
export const OVERLAP_DAYS = 7;

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

/** Whether the daily sync may write a preview row without the user. */
export function autoWritable(row: ImportRow): boolean {
  return row.status === "new"
    && AUTO_KINDS.has(row.kind)
    && !row.possibleDuplicate
    && !row.learnedPayment
    && (row.warnings ?? []).length === 0;
}

/** Rows the user must look at: new, but not clean. */
export function heldForReview(rows: ImportRow[]): number {
  return rows.filter(r => r.status === "new" && !autoWritable(r)).length;
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

/** First day the daily sync reads for an account already reviewed: a week
 *  before the last sync (late bookings), never before the last review (the
 *  user has seen, and kept or dismissed, everything up to then). */
export function syncDateFrom(account: { bankReviewedAt: Date }, lastSyncedAt: Date | null): string {
  const base = lastSyncedAt && lastSyncedAt > account.bankReviewedAt ? lastSyncedAt : account.bankReviewedAt;
  const overlap = isoDay(new Date(base.getTime() - OVERLAP_DAYS * DAY_MS));
  const reviewed = isoDay(account.bankReviewedAt);
  return overlap > reviewed ? overlap : reviewed;
}

/** First day the review preview reads: FIRST_SYNC_DAYS back the first time;
 *  afterwards from the day of the last review. */
export function reviewDateFrom(account: { bankReviewedAt: Date | null }, now: Date): string {
  return account.bankReviewedAt ? isoDay(account.bankReviewedAt) : isoDay(new Date(now.getTime() - FIRST_SYNC_DAYS * DAY_MS));
}

/** What a card's balance says is owed. Banks report it negative (holder's
 *  view) or positive: the magnitude is what's owed either way. */
export function owedFromCardBalance(amountCents: number): number {
  return Math.abs(amountCents);
}

export interface LinkedAccount {
  id: string;
  type: string;
  externalAccountId: string | null;
  bankReviewedAt: Date | null;
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
): Promise<ImportPreview & { pendingCount: number }> {
  const txns = await client.getAccountTransactions(account.externalAccountId!, dateFrom);
  const preview = await prepareImport(connection.userId, {
    accountId: account.id,
    rows: toNormalizedRows(txns.booked),
    purchasesSign: "negative",
  });
  const { purchasesSign: _sign, purchasesSignDetected: _detected, skipped: _skipped, source: _source, ...rest } = preview;
  return { ...rest, pendingCount: txns.pendingCount };
}

const kindOf = (account: { type: string }): BankAccountKind => (account.type === "card" ? "card" : account.type === "savings" ? "savings" : "checking");

/** Brings an account's (or card debt's) balance in line with the bank. */
export async function refreshBalance(client: BankingProviderClient, connection: ConnectionCtx, account: LinkedAccount): Promise<void> {
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
  await setLiveValues(connection.userId, debt.id, { balance: owedFromCardBalance(balance.amountCents) });
  await prisma.debt.update({ where: { id: debt.id }, data: { balanceSource: "bank_sync", balanceSyncedAt: now } });
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
  connection: ConnectionCtx & { lastSyncedAt: Date | null },
  account: LinkedAccount & { bankReviewedAt: Date },
  householdId: string | null,
): Promise<AccountSyncResult> {
  const preview = await previewBankAccount(client, connection, account, syncDateFrom(account, connection.lastSyncedAt));
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
  await prisma.account.update({ where: { id: account.id }, data: { bankPendingReview: held } });
  if (account.type !== "card" || held === 0) await refreshBalance(client, connection, account);
  return { written, held };
}

export const SYNCABLE_STATUSES = ["active", "error"];

export interface SyncResult {
  ok: boolean;
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
export async function syncConnection(client: BankingProviderClient, connectionId: string, now = new Date()): Promise<SyncResult> {
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

  const householdId = await householdOf(connection.ownerUserId);
  const result = { ...empty };
  try {
    for (const account of connection.accounts) {
      if (!account.bankReviewedAt) { result.awaitingFirstReview++; continue; }
      const r = await syncAccount(client, connection, { ...account, bankReviewedAt: account.bankReviewedAt }, householdId);
      result.written += r.written;
      result.held += r.held;
    }
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "active", lastSyncedAt: now, lastSyncError: null },
    });
    return { ok: true, ...result };
  } catch (err) {
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
