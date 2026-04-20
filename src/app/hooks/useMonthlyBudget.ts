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
}

export function useMonthlyBudget(month: string) {
  const [budgets, setBudgets] = useState<MonthlyBudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchBudgets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/monthly-budgets?month=${month}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setBudgets(data.budgets);
    } catch {
      setBudgets([]);
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

  return { budgets, loading, saving, isSaved, fetchBudgets, saveBudgets };
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
