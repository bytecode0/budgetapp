// Transaction sync — reuses the exact import pipeline (dedup, categorization,
// write path) that manual statement uploads already go through
// (server/lib/importStatement.ts, server/routes/expenses.ts /import/confirm).
// The only new thing here is the adapter from a provider's JSON transactions
// to the same ImportRow shape — everything downstream (categorize(), the
// @@unique([userId, externalId]) dedup, recurring detection) is untouched.
import { prisma } from "../prisma.js";
import { normalizeMerchant } from "../normalizeMerchant.js";
import { categorize, learnFromCorrection } from "../categorize.js";
import { toCents } from "../money.js";
import { getBankingClient } from "./gocardless.js";
import type { ImportKind, ImportPreview, ImportRow } from "../importStatement.js";
import type { BankProviderTxn } from "./types.js";

// Namespaced by provider so a provider's native id can never collide with the
// content-hash externalId the manual file-import path uses for the same
// account — the two dedup strategies are never mixed for one account.
export function externalIdForProviderTxn(provider: string, providerTxnId: string): string {
  return `${provider}:${providerTxnId}`;
}

// Pure mapping — no DB, no network — from a provider transaction to the same
// shape prepareImport() produces per row (minus dedup status/suggestion,
// which need a DB round-trip and are added by buildPreviewFromProviderTxns).
export function mapProviderTxn(txn: BankProviderTxn, provider: string): Omit<ImportRow, "status" | "suggestedAllocationId" | "suggestedAllocationName"> {
  const merchant = normalizeMerchant(txn.description);
  return {
    externalId: externalIdForProviderTxn(provider, txn.id),
    date: txn.date,
    description: txn.description,
    merchant,
    amount: Math.abs(txn.amount),
    signedAmount: txn.amount,
    kind: (txn.amount < 0 ? "expense" : "income") as ImportKind,
  };
}

/** Same shape/behavior as prepareImport() (importStatement.ts), sourced from
 *  provider transactions instead of a parsed statement grid. */
export async function buildPreviewFromProviderTxns(
  userId: string,
  provider: string,
  txns: BankProviderTxn[],
): Promise<ImportPreview> {
  const mapped = txns.map(t => mapProviderTxn(t, provider));

  const ids = mapped.map(m => m.externalId);
  const [existExp, existInc] = await Promise.all([
    prisma.expense.findMany({ where: { userId, externalId: { in: ids } }, select: { externalId: true } }),
    prisma.income.findMany({ where: { userId, externalId: { in: ids } }, select: { externalId: true } }),
  ]);
  const seen = new Set<string>([...existExp, ...existInc].map(e => e.externalId!));

  const rows: ImportRow[] = [];
  for (const m of mapped) {
    const isNew = !seen.has(m.externalId);
    let suggestedAllocationId: string | null = null;
    if (m.kind === "expense" && isNew) {
      suggestedAllocationId = await categorize(userId, m.description, m.merchant);
    }
    rows.push({ ...m, status: isNew ? "new" : "duplicate", suggestedAllocationId, suggestedAllocationName: null });
  }

  return {
    rows,
    newCount: rows.filter(r => r.status === "new").length,
    duplicateCount: rows.filter(r => r.status === "duplicate").length,
    expenseCount: rows.filter(r => r.kind === "expense").length,
    incomeCount: rows.filter(r => r.kind === "income").length,
  };
}

interface ConfirmableRow {
  kind: ImportKind;
  externalId: string;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  allocationId?: string | null;
}

/** Writes rows through the exact same createMany+skipDuplicates path as
 *  /api/expenses/import/confirm, tagged with a distinct source so their
 *  provenance is visible everywhere Expense/Income.source is shown. */
export async function writeSyncedRows(
  userId: string,
  ownerUserId: string,
  accountId: string | null,
  rows: ConfirmableRow[],
): Promise<{ expenses: number; income: number }> {
  const expenseRows = rows.filter(r => r.kind === "expense");
  const incomeRows = rows.filter(r => r.kind === "income");

  const [exp, inc] = await Promise.all([
    prisma.expense.createMany({
      data: expenseRows.map(r => ({
        userId, accountId, allocationId: r.allocationId || null,
        amount: toCents(r.amount), description: r.description, merchant: r.merchant,
        source: "bank_sync", externalId: r.externalId, date: new Date(r.date),
      })),
      skipDuplicates: true,
    }),
    prisma.income.createMany({
      data: incomeRows.map(r => ({
        userId, ownerUserId, accountId,
        amount: toCents(r.amount), description: r.description, merchant: r.merchant,
        category: "other", source: "bank_sync", externalId: r.externalId, date: new Date(r.date),
      })),
      skipDuplicates: true,
    }),
  ]);

  // Learn merchant -> allocation for future syncs/manual entry, mirroring
  // /import/confirm exactly. Best-effort: must not fail an otherwise-good sync.
  try {
    const merchantToAllocation = new Map<string, string>();
    for (const r of expenseRows) if (r.merchant && r.allocationId) merchantToAllocation.set(r.merchant, r.allocationId);
    for (const [merchant, allocationId] of merchantToAllocation) {
      await learnFromCorrection(userId, merchant, allocationId);
    }
  } catch (err) {
    console.error("[banking/sync] learn", err);
  }

  return { expenses: exp.count, income: inc.count };
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface SyncResult { ok: boolean; expenses: number; income: number; balancesUpdated: number; error?: string }

/** Syncs every linked account on a connection: new transactions write
 *  directly (silent — no review step) using whatever categorize() suggests,
 *  since by this point the FIRST sync has already seeded real rules via the
 *  review screen. Also refreshes each linked account's balance (Phase 3). */
export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const connection = await prisma.bankConnection.findUnique({
    where: { id: connectionId },
    include: { accounts: true, debts: true },
  });
  if (!connection) return { ok: false, expenses: 0, income: 0, balancesUpdated: 0, error: "Connection not found" };

  const client = getBankingClient();
  if (!client) return { ok: false, expenses: 0, income: 0, balancesUpdated: 0, error: "Open Banking is not configured" };

  let totalExpenses = 0, totalIncome = 0, balancesUpdated = 0;
  try {
    const sinceDate = connection.lastSyncedAt ? isoDay(connection.lastSyncedAt) : undefined;

    for (const account of connection.accounts) {
      if (!account.externalAccountId) continue;

      const txns = await client.getAccountTransactions(account.externalAccountId, sinceDate);
      const preview = await buildPreviewFromProviderTxns(connection.userId, connection.provider, txns);
      const newRows = preview.rows.filter(r => r.status === "new").map(r => ({ ...r, allocationId: r.suggestedAllocationId }));
      const written = await writeSyncedRows(connection.userId, connection.ownerUserId, account.id, newRows);
      totalExpenses += written.expenses;
      totalIncome += written.income;

      const balance = await client.getAccountBalance(account.externalAccountId);
      if (balance) {
        await prisma.account.update({
          where: { id: account.id },
          data: { currentBalance: toCents(balance.amount), balanceSource: "bank_sync", balanceSyncedAt: new Date() },
        });
        balancesUpdated += 1;
      }
    }

    for (const debt of connection.debts) {
      if (!debt.externalAccountId) continue;
      const balance = await client.getAccountBalance(debt.externalAccountId);
      if (balance) {
        // A card's balance is what's owed, i.e. the positive magnitude of a
        // typically-negative account balance.
        await prisma.debt.update({
          where: { id: debt.id },
          data: { currentBalance: toCents(Math.abs(balance.amount)), balanceSource: "bank_sync", balanceSyncedAt: new Date() },
        });
        balancesUpdated += 1;
      }
    }

    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { status: "active", lastSyncedAt: new Date(), lastSyncError: null },
    });
    return { ok: true, expenses: totalExpenses, income: totalIncome, balancesUpdated };
  } catch (err: any) {
    const message = String(err?.message ?? err);
    // 401/403 from the provider means the bank-side consent has lapsed (PSD2
    // requisitions expire, typically ~90 days) — distinct from a transient/
    // unexpected error, since the fix is "reconnect," not "retry later."
    const isAuthFailure = /\b(401|403)\b/.test(message);
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { status: isAuthFailure ? "expired" : "error", lastSyncError: message },
    });
    return { ok: false, expenses: totalExpenses, income: totalIncome, balancesUpdated, error: message };
  }
}
