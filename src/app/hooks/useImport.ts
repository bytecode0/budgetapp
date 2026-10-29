import { useState } from 'react';
import type { StatementSample } from '../../../shared/ingest/read';
import type { ColumnMapping, ReadResult, SkippedRow, StatementSource } from '../../../shared/ingest/types';
import type { ShapeInput } from '../../../shared/ingest/shapes';
import { toWireRows, toWireSkipped } from '../../../shared/ingest/validate';
import { readStatementFile, sampleStatementFile, SERVER_READ_MAX_BYTES } from '../lib/readStatementFile';

export type { ColumnMapping, StatementSample };

// payment: pays a debt (a card payment); refund: a card refund — lowers its
// category's spending and the card debt (server/lib/ingest/classify.ts).
// needs_review: a card credit the importer won't guess — the user calls it a
// payment or a refund before it can be imported.
export type ImportKind = 'expense' | 'income' | 'payment' | 'refund' | 'needs_review';
export type ConfirmKind = Exclude<ImportKind, 'needs_review'>;

export interface PossibleDuplicate { id: string; table: 'expense' | 'income'; date: string; description: string; source: string }

export interface ImportRow {
  externalId: string;
  date: string;          // yyyy-mm-dd
  description: string;
  merchant: string;
  amount: number;        // euros, absolute
  signedAmount: number;  // euros, signed
  kind: ImportKind;
  status: 'new' | 'duplicate';
  suggestedAllocationId: string | null;
  suggestedAllocationName: string | null;
  debtId?: string | null;
  isFee?: boolean;
  duplicateReason?: 'same_movement' | 'same_payment';
  possibleDuplicate?: PossibleDuplicate;
  /** Bank rows whose debt can be changed: stored payments of the same amount
   *  nearby, by debt — a possible duplicate once that debt is picked. */
  storedPayments?: (PossibleDuplicate & { debtId: string })[];
  /** A payment proposed from a learned rule: the user confirms it. */
  learnedPayment?: { preselect: boolean };
  warnings?: ('currency_mismatch' | 'ambiguous_credit' | 'card_payment_unassigned' | 'possible_card_payment' | 'learned_payment')[];
}

export interface ImportPreview {
  rows: ImportRow[];
  newCount: number;
  duplicateCount: number;
  expenseCount: number;
  incomeCount: number;
  paymentCount?: number;
  refundCount?: number;
  reviewCount?: number;
  possibleDuplicateCount?: number;
  mode?: 'account' | 'card';
  /** Debts a bank row may pay (for the payment's debt picker). */
  debts?: { id: string; name: string }[];
  /** Card files: how purchases appear; 'unknown' until the user chooses. */
  purchasesSign?: PurchasesSign | 'unknown';
  purchasesSignDetected?: boolean;
  /** Rows the file lists that aren't movements yet (Revolut PENDING…). */
  skipped?: SkippedRow[];
  source?: StatementSource;
}

/** What the preview is built from: rows read in this browser (decision O),
 *  or — only when the browser's reader failed and the file is small — the
 *  file itself, read by the server. */
export type PreviewSource = { kind: 'rows'; read: ReadResult } | { kind: 'file'; file: File };

export type ReadOutcome =
  | { source: PreviewSource }
  | { code: string; sample?: StatementSample[] };

export type PurchasesSign = 'negative' | 'positive';

/** What a confirm wrote (POST /api/expenses/import/confirm), for the summary. */
export interface ImportSummary {
  expenses: number;
  refunds: number;
  incomes: number;
  payments: { debtId: string; name: string | null; count: number }[];
}

export interface ConfirmRow {
  kind: ConfirmKind;
  externalId: string;
  date: string;
  description: string;
  merchant: string;
  amount: number;
  allocationId?: string | null;
  category?: string;
  debtId?: string | null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(',') + 1)); // strip "data:...;base64,"
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export interface AiSuggestion {
  merchant: string;
  allocationId: string;
  name: string | null;
}

export interface AiCategory {
  name: string;
  icon: string;
  merchants: string[];
}

export function useImport() {
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [suggestingCats, setSuggestingCats] = useState(false);

  /** Reads the file here with the account's mapping (if any). A reader
   *  failure falls back to the server for files under its body limit. */
  const read = async (file: File, mapping: ColumnMapping | null): Promise<ReadOutcome> => {
    setLoading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await readStatementFile(bytes, file.name, mapping);
      if (r.ok) return { source: { kind: 'rows', read: r.result } };
      if (r.code === 'reader_failed' && file.size <= SERVER_READ_MAX_BYTES) return { source: { kind: 'file', file } };
      return { code: r.code, ...('sample' in r && r.sample ? { sample: r.sample } : {}) };
    } catch {
      return { code: 'reader_failed' };
    } finally {
      setLoading(false);
    }
  };

  /** The file's first rows, for the manual mapping (null: nothing to map). */
  const sample = async (file: File): Promise<StatementSample[] | null> => {
    try {
      return await sampleStatementFile(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return null;
    }
  };

  const preview = async (
    source: PreviewSource, accountId: string | null, purchasesSign?: PurchasesSign,
  ): Promise<{ error?: string; code?: string; sample?: StatementSample[]; preview?: ImportPreview }> => {
    setLoading(true);
    try {
      // A sign the user chose wins over the one the mapping states.
      const sign = purchasesSign ?? (source.kind === 'rows' ? source.read.purchasesSign : undefined);
      const body = source.kind === 'rows'
        ? { accountId, rows: toWireRows(source.read.rows), skipped: toWireSkipped(source.read.skipped), source: source.read.source }
        : { accountId, filename: source.file.name, dataBase64: await fileToBase64(source.file) };
      const res = await fetch('/api/expenses/import/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...(sign ? { purchasesSign: sign } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Failed to read the file', code: data.code, sample: data.sample };
      return { preview: data as ImportPreview };
    } catch {
      return { error: 'Could not read the file' };
    } finally {
      setLoading(false);
    }
  };

  /** The account's saved column mapping; null when none or not readable. */
  const loadProfile = async (accountId: string): Promise<ColumnMapping | null> => {
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/import-profile`, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return (data?.data?.importProfile ?? null) as ColumnMapping | null;
    } catch {
      return null;
    }
  };

  /** Saves how this account's files are read (owner only: 403 otherwise). */
  const saveProfile = async (accountId: string, mapping: ColumnMapping): Promise<{ ok: true } | { error: string; status?: number }> => {
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(accountId)}/import-profile`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importProfile: mapping }),
      });
      if (!res.ok) return { error: 'save_failed', status: res.status };
      return { ok: true };
    } catch {
      return { error: 'network' };
    }
  };

  /** An AI suggestion for the manual mapping, from the column titles the
   *  user saw and cell formats (shared/ingest/shapes.ts) — never amounts or rows. */
  const suggestMapping = async (input: ShapeInput): Promise<{ mapping: ColumnMapping } | { code: string }> => {
    try {
      const res = await fetch('/api/expenses/import/suggest-mapping', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) return { code: (data?.code as string | undefined) ?? 'ai_failed' };
      return { mapping: data.data.mapping as ColumnMapping };
    } catch {
      return { code: 'ai_failed' };
    }
  };

  const confirm = async (
    accountId: string | null, rows: ConfirmRow[],
  ): Promise<{ error: string; code?: string } | { inserted: number; summary: ImportSummary }> => {
    setConfirming(true);
    try {
      const res = await fetch('/api/expenses/import/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, rows }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Failed to import', code: data.code as string | undefined };
      return { inserted: data.inserted as number, summary: data.summary as ImportSummary };
    } catch {
      return { error: 'Network error' };
    } finally {
      setConfirming(false);
    }
  };

  // AI-classify rule-less merchants. Returns suggestions to merge into the
  // preview; never throws — degrades to an error string the UI can toast.
  const classify = async (
    merchants: string[],
  ): Promise<{ error?: string; suggestions?: AiSuggestion[] }> => {
    setClassifying(true);
    try {
      const res = await fetch('/api/expenses/import/classify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchants }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'AI classification failed' };
      return { suggestions: (data.suggestions ?? []) as AiSuggestion[] };
    } catch {
      return { error: 'Network error' };
    } finally {
      setClassifying(false);
    }
  };

  // AI proposes a category set from the merchants (cold-start helper).
  const suggestCategories = async (
    merchants: string[],
  ): Promise<{ error?: string; categories?: AiCategory[] }> => {
    setSuggestingCats(true);
    try {
      const res = await fetch('/api/expenses/import/suggest-categories', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merchants }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'AI suggestion failed' };
      return { categories: (data.categories ?? []) as AiCategory[] };
    } catch {
      return { error: 'Network error' };
    } finally {
      setSuggestingCats(false);
    }
  };

  return { loading, confirming, classifying, suggestingCats, read, sample, preview, loadProfile, saveProfile, suggestMapping, confirm, classify, suggestCategories };
}
