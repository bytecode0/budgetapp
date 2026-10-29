import { useState } from 'react';

// payment: pays a debt (a card payment); refund: a card refund — lowers its
// category's spending and the card debt (server/lib/ingest/classify.ts).
// needs_review: a card credit the importer won't guess — the user calls it a
// payment or a refund before it can be imported.
export type ImportKind = 'expense' | 'income' | 'payment' | 'refund' | 'needs_review';
export type ConfirmKind = Exclude<ImportKind, 'needs_review'>;

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
  possibleDuplicate?: { id: string; table: 'expense' | 'income'; date: string; description: string; source: string };
  /** A payment proposed from a learned rule: the user confirms it. */
  learnedPayment?: { preselect: boolean };
  warnings?: ('currency_mismatch' | 'ambiguous_credit' | 'card_payment_unassigned' | 'learned_payment')[];
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
}

export type PurchasesSign = 'negative' | 'positive';

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

  const preview = async (
    file: File, accountId: string | null, purchasesSign?: PurchasesSign,
  ): Promise<{ error?: string; code?: string; preview?: ImportPreview }> => {
    setLoading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch('/api/expenses/import/preview', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, dataBase64, accountId, ...(purchasesSign ? { purchasesSign } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Failed to read the file', code: data.code };
      return { preview: data as ImportPreview };
    } catch {
      return { error: 'Could not read the file' };
    } finally {
      setLoading(false);
    }
  };

  const confirm = async (accountId: string | null, rows: ConfirmRow[]) => {
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
      return { inserted: data.inserted as number, expenses: data.expenses as number, income: data.income as number };
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

  return { loading, confirming, classifying, suggestingCats, preview, confirm, classify, suggestCategories };
}
