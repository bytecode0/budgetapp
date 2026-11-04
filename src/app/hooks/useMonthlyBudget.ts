import { useState, useEffect, useCallback } from 'react';

export interface MonthlyBudgetRow {
  allocationId: string;
  month: string;
  allocatedAmount: number;
  saved: boolean;
  allocation: {
    id: string;
    name: string;
    icon: string;
    type: string;
    sortOrder: number;
  };
}

export interface BudgetReviewRow {
  allocationId: string;
  name: string;
  icon: string;
  type: string;
  budgeted: number;
  actual: number;
  diff: number;        // positive = over budget
  hasSavedBudget: boolean;
}

export interface BudgetReview {
  review: BudgetReviewRow[];
  totalBudgeted: number;
  totalActual: number;
  unassigned: number;
  month: string;
  /** The household's income this month (euros): recorded, else its baseline. */
  householdIncome: number;
  householdIncomeSource: 'recorded' | 'baseline';
}

export function useMonthlyBudget(month: string) {
  const [budgets, setBudgets] = useState<MonthlyBudgetRow[]>([]);
  // The partner's private debt lines this month (euros), never listed.
  const [hiddenCommitted, setHiddenCommitted] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchBudgets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monthly-budgets?month=${month}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setBudgets(data.budgets);
      setHiddenCommitted(data.hiddenCommitted ?? 0);
    } catch {
      setBudgets([]);
      setHiddenCommitted(0);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  const saveBudgets = async (entries: { allocationId: string; allocatedAmount: number }[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/monthly-budgets/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, budgets: entries }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Failed to save' };
      setBudgets(data.budgets);
      return { budgets: data.budgets };
    } catch {
      return { error: 'Network error' };
    } finally {
      setSaving(false);
    }
  };

  const isSaved = budgets.some(b => b.saved);

  return { budgets, hiddenCommitted, loading, saving, isSaved, fetchBudgets, saveBudgets };
}

export function useMonthlyReview(month: string) {
  const [review, setReview] = useState<BudgetReview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReview = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monthly-budgets/review?month=${month}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setReview(data);
    } catch {
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchReview(); }, [fetchReview]);

  return { review, loading, fetchReview };
}
