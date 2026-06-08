import { useState, useEffect, useCallback } from 'react';

export interface MonthSpending {
  month: string; // "2026-04"
  total: number; // euros
}

export interface CategoryAvg {
  allocationId: string;
  name: string;
  icon: string;
  total: number; // euros, summed over the range
  avg: number;   // euros, average per month
}

export interface SavingsPoint {
  month: string;
  deposited: number;  // euros deposited that month
  cumulative: number; // euros, running savings balance
}

export interface Alignment {
  month: string;
  pct: number;       // 0–100, how well spending tracks the plan
  budgeted: number;  // euros
  actual: number;    // euros
}

export interface Analytics {
  from: string;
  to: string;
  months: MonthSpending[];
  byCategory: CategoryAvg[];
  savings: SavingsPoint[];
  alignment: Alignment;
}

export function useAnalytics(from: string, to: string) {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/analytics?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load analytics');
      const data = await res.json();
      setAnalytics(data);
    } catch {
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  return { analytics, loading, fetchAnalytics };
}
