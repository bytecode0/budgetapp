import { cachedDarkMode } from '../lib/theme';
import { useState, useEffect, useCallback } from 'react';

export interface Allocation {
  id: string;
  userId: string;
  name: string;
  icon: string;
  type: string; // 'fixed' | 'flexible' | 'plan' | 'debt' | 'generosity'
  lifePlanId: string | null;
  debtId: string | null;
  allocatedAmount: number;
  actualAmount: number;
  sortOrder: number;
  isDefault: boolean;
}

export interface BudgetSuggestionRow {
  allocationId: string;
  name: string;
  icon: string;
  current: number;   // euros
  suggested: number; // euros
  monthsObserved: number;
  confidence: 'high' | 'medium' | 'low';
}

export function useAllocations() {
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  // monthlyIncome = the household's baseline (every member's summed);
  // ownMonthlyIncome = the signed-in person's own, the only one they may edit.
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [ownMonthlyIncome, setOwnMonthlyIncome] = useState(0);
  const [isCouple, setIsCouple] = useState(false);
  // Start from this device's copy so the theme doesn't flash before the server answers.
  const [darkMode, setDarkMode] = useState(cachedDarkMode);
  const [dbLanguage, setDbLanguage] = useState<string>('es');
  const [cycleStartDay, setCycleStartDay] = useState(1);
  // What the partner's private debt lines commit (euros): not listed, but
  // part of the household's budget (server/lib/poolRefs.ts).
  const [hiddenCommitted, setHiddenCommitted] = useState(0);
  // The Generosity line's share of the household's income (LPBETA-10); null = a fixed amount.
  const [generosityBps, setGenerosityBps] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAllocations = useCallback(async () => {
    try {
      const res = await fetch('/api/allocations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load allocations');
      const data = await res.json();
      setAllocations(data.allocations);
      setMonthlyIncome(data.monthlyIncome);
      setOwnMonthlyIncome(data.ownMonthlyIncome ?? 0);
      setIsCouple(data.isCouple ?? false);
      setDarkMode(data.darkMode ?? false);
      setDbLanguage(data.language ?? 'es');
      setCycleStartDay(data.cycleStartDay ?? 1);
      setHiddenCommitted(data.hiddenCommitted ?? 0);
      setGenerosityBps(typeof data.generosityBps === 'number' ? data.generosityBps : null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAllocations(); }, [fetchAllocations]);

  /** Sets the signed-in person's OWN baseline (never the household sum). */
  const updateIncome = async (amount: number) => {
    const res = await fetch('/api/allocations/settings/income', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyIncome: amount }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update income' };
    setMonthlyIncome(data.monthlyIncome);
    setOwnMonthlyIncome(data.ownMonthlyIncome ?? 0);
    setIsCouple(data.isCouple ?? false);
    return {};
  };

  const createAllocation = async (payload: {
    name: string;
    icon: string;
    type: string;
    allocatedAmount?: number;
    lifePlanId?: string | null;
    debtId?: string | null;
  }) => {
    const res = await fetch('/api/allocations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create allocation' };
    setAllocations((a) => [...a, data.allocation]);
    return { allocation: data.allocation };
  };

  const updatePayday = async (day: number) => {
    const res = await fetch('/api/allocations/settings/payday', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycleStartDay: day }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update payday' };
    setCycleStartDay(data.cycleStartDay);
    return {};
  };

  /** `month`: the month on screen, so the server can tell a Generosity share
   *  echoed back from a typed amount (server/lib/generosity.ts). */
  const updateAllocation = async (id: string, payload: Partial<Allocation> & { month?: string }) => {
    const res = await fetch(`/api/allocations/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update' };
    setAllocations((a) => a.map((x) => (x.id === id ? data.allocation : x)));
    return { allocation: data.allocation };
  };

  const deleteAllocation = async (id: string) => {
    const res = await fetch(`/api/allocations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) return { error: 'Failed to delete allocation' };
    setAllocations((a) => a.filter((x) => x.id !== id));
    return {};
  };

  const updateLanguage = async (value: string) => {
    const res = await fetch('/api/allocations/settings/display', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: value }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update language' };
    setDbLanguage(data.language);
    return {};
  };

  // Optimistic: the theme changes on tap; if the server refuses, it goes back.
  const updateDarkMode = async (value: boolean) => {
    const previous = darkMode;
    setDarkMode(value);
    try {
      const res = await fetch('/api/allocations/settings/display', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ darkMode: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDarkMode(previous);
        return { error: data.error || 'Failed to update display settings' };
      }
      setDarkMode(data.darkMode);
      return {};
    } catch {
      setDarkMode(previous);
      return { error: 'Failed to update display settings' };
    }
  };

  const reorderAllocations = async (order: { id: string; sortOrder: number }[]) => {
    const res = await fetch('/api/allocations/reorder', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) return { error: 'Failed to reorder' };
    return {};
  };

  const fetchSuggestedBudgets = async (months = 6): Promise<{ error?: string; suggestions?: BudgetSuggestionRow[] }> => {
    try {
      const res = await fetch(`/api/allocations/suggested-budgets?months=${months}`, { credentials: 'include' });
      if (!res.ok) return { error: 'Failed to load suggestions' };
      const data = await res.json();
      return { suggestions: (data.suggestions ?? []) as BudgetSuggestionRow[] };
    } catch {
      return { error: 'Network error' };
    }
  };

  const applyBudgets = async (budgets: { id: string; allocatedAmount: number }[]) => {
    const res = await fetch('/api/allocations/budgets', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budgets }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to apply budgets' };
    const map = new Map(budgets.map(b => [b.id, b.allocatedAmount]));
    setAllocations(a => a.map(x => (map.has(x.id) ? { ...x, allocatedAmount: map.get(x.id)! } : x)));
    return { updated: data.updated as number };
  };

  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedAmount, 0) + hiddenCommitted;
  const unallocated = Math.max(0, monthlyIncome - totalAllocated);

  return {
    allocations, monthlyIncome, ownMonthlyIncome, isCouple, darkMode, dbLanguage, cycleStartDay, generosityBps, loading, error, totalAllocated, unallocated, hiddenCommitted,
    fetchAllocations, updateIncome, updateDarkMode, updateLanguage, updatePayday, createAllocation, updateAllocation, deleteAllocation, reorderAllocations,
    fetchSuggestedBudgets, applyBudgets,
  };
}
