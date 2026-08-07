import { useState, useEffect, useCallback } from 'react';

export type DebtKind = 'credit_card' | 'installment' | 'bnpl' | 'payday_loan' | 'auto_loan' | 'other';
export type DebtStatus = 'active' | 'paid_off' | 'archived';

export interface Debt {
  id: string;
  userId: string;
  ownerUserId: string;
  name: string;
  kind: DebtKind;
  status: DebtStatus;
  sortOrder: number;
  accountId: string | null;
  currentBalance: number; // euros
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
  accountId?: string | null;
  currentBalance?: number;
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
    setTotalOwed(active.reduce((s, d) => s + d.currentBalance, 0));
    setTotalMinimums(active.reduce((s, d) => s + (d.minimumPayment ?? d.installmentAmount ?? 0), 0));
  };

  const createDebt = async (payload: DebtPayload) => {
    const res = await fetch('/api/debts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create debt' };
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
    if (!res.ok) return { error: data.error || 'Failed to update debt' };
    setDebts(d => {
      const next = d.map(x => (x.id === id ? data.debt : x));
      recomputeTotals(next);
      return next;
    });
    return { debt: data.debt as Debt };
  };

  const deleteDebt = async (id: string) => {
    const res = await fetch(`/api/debts/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) return { error: 'Failed to delete debt' };
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

  const fetchPayoff = async (extra = 0): Promise<{ snowball: PayoffSummary | null; avalanche: PayoffSummary | null } | null> => {
    try {
      const res = await fetch(`/api/debts/payoff?extra=${extra}`, { credentials: 'include' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  return {
    debts, totalOwed, totalMinimums, timeline, loading, error,
    fetchDebts, createDebt, updateDebt, deleteDebt, reorderDebts, fetchTimeline, fetchPayoff,
  };
}
