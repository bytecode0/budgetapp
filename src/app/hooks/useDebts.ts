import { useState, useEffect, useCallback } from 'react';
import { recordDebtPayment } from '../lib/debtPayments';

export type DebtKind = 'credit_card' | 'installment' | 'bnpl' | 'payday_loan' | 'auto_loan' | 'student_loan' | 'mortgage' | 'other';
export type DebtStatus = 'active' | 'paid_off' | 'archived';
export type DebtPaymentMode = 'full' | 'installments' | 'minimum';

export interface Debt {
  id: string;
  userId: string;
  ownerUserId: string;
  name: string;
  kind: DebtKind;
  status: DebtStatus;
  sortOrder: number;
  accountId: string | null;
  paymentMode: DebtPaymentMode;
  // Live values, derived server-side (server/lib/debtBalance.ts): what's owed
  // now = anchor + card purchases − payments recorded since the anchor.
  currentBalance: number; // euros — live ledger balance (sent back by the edit form)
  owed: number; // euros — what's owed now (owedNow): what every "owed" / total shows
  anchorBalance: number; // euros — the balance last set by hand or bank sync
  previousBalance: number; // euros — what's left of the pre-existing debt
  purchasesTotal: number; // euros
  paymentsTotal: number; // euros
  monthlyCommitment: number; // euros — this period's budget line
  principal: number | null; // euros
  apr: number | null;
  creditLimit: number | null; // euros
  statementDay: number | null;
  paymentDueDay: number | null;
  minimumPayment: number | null; // euros
  installmentAmount: number | null; // euros
  installmentsTotal: number | null;
  installmentsPaid: number;
  startDate: string | null;
  endDate: string | null;
  visibility?: 'private' | 'household';
  householdId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DebtPayload {
  name: string;
  kind?: DebtKind;
  paymentMode?: DebtPaymentMode;
  accountId?: string | null;
  currentBalance?: number; // live balance — the server moves the anchor to match
  principal?: number | null;
  apr?: number | null;
  creditLimit?: number | null;
  statementDay?: number | null;
  paymentDueDay?: number | null;
  minimumPayment?: number | null;
  installmentAmount?: number | null;
  installmentsTotal?: number | null;
  installmentsPaid?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  status?: DebtStatus;
  visibility?: 'private' | 'household';
}

export interface TimelinePeriodItem { debtId: string; name: string; kind: DebtKind; amount: number }
export interface TimelinePeriod {
  period: string;
  committed: number; // euros
  expectedIncome: number; // euros
  pctCommitted: number;
  items: TimelinePeriodItem[];
}

export type PayoffMethod = 'snowball' | 'avalanche';
export interface PayoffOrderEntry { id: string; name: string | null; monthPaidOff: number }
export interface PayoffSummary {
  method: PayoffMethod;
  months: number;
  totalInterestPaid: number; // euros
  totalPaid: number; // euros
  payoffOrder: PayoffOrderEntry[];
}

export function useDebts() {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [totalOwed, setTotalOwed] = useState(0);
  const [totalMinimums, setTotalMinimums] = useState(0);
  const [timeline, setTimeline] = useState<TimelinePeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Not auto-fetched — only screens that show the forward timeline (Home) call this.
  const fetchTimeline = useCallback(async (periods = 6) => {
    try {
      const res = await fetch(`/api/debts/timeline?periods=${periods}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setTimeline(data.timeline ?? []);
    } catch { /* best-effort */ }
  }, []);

  const fetchDebts = useCallback(async () => {
    try {
      const res = await fetch('/api/debts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load debts');
      const data = await res.json();
      setDebts(data.debts);
      setTotalOwed(data.totalOwed);
      setTotalMinimums(data.totalMinimums);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDebts(); }, [fetchDebts]);

  const recomputeTotals = (list: Debt[]) => {
    const active = list.filter(d => d.status === 'active');
    setTotalOwed(active.reduce((s, d) => s + d.owed, 0));
    setTotalMinimums(active.reduce((s, d) => s + d.monthlyCommitment, 0));
  };

  const createDebt = async (payload: DebtPayload) => {
    const res = await fetch('/api/debts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: (data.error as string) || 'Failed to create debt', code: data.code as string | undefined };
    setDebts(d => {
      const next = [...d, data.debt];
      recomputeTotals(next);
      return next;
    });
    return { debt: data.debt as Debt };
  };

  const updateDebt = async (id: string, payload: Partial<DebtPayload>) => {
    const res = await fetch(`/api/debts/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: (data.error as string) || 'Failed to update debt', code: data.code as string | undefined };
    setDebts(d => {
      const next = d.map(x => (x.id === id ? data.debt : x));
      recomputeTotals(next);
      return next;
    });
    return { debt: data.debt as Debt };
  };

  const deleteDebt = async (id: string) => {
    const res = await fetch(`/api/debts/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: (data.error as string) || 'Failed to delete debt', code: data.code as string | undefined };
    }
    setDebts(d => {
      const next = d.filter(x => x.id !== id);
      recomputeTotals(next);
      return next;
    });
    return {};
  };

  const reorderDebts = async (order: { id: string; sortOrder: number }[]) => {
    const res = await fetch('/api/debts/reorder', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) return { error: 'Failed to reorder' };
    return {};
  };

  // See recordDebtPayment; refetches so the live balance shows the payment.
  const recordPayment = async (
    debt: { id: string; name: string },
    payment: { amount: number; accountId: string; date: string; description: string },
  ): Promise<{ code?: string }> => {
    const result = await recordDebtPayment(debt, payment);
    if (!result.code) await fetchDebts();
    return result;
  };

  const fetchPayoff = async (extra = 0, scope?: 'consumer'): Promise<{ snowball: PayoffSummary | null; avalanche: PayoffSummary | null } | null> => {
    try {
      const params = new URLSearchParams({ extra: String(extra) });
      if (scope) params.set('scope', scope);
      const res = await fetch(`/api/debts/payoff?${params}`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  return {
    debts, totalOwed, totalMinimums, timeline, loading, error,
    fetchDebts, createDebt, updateDebt, deleteDebt, reorderDebts, fetchTimeline, fetchPayoff, recordPayment,
  };
}
