import { useState, useEffect, useCallback } from 'react';

export interface Allocation {
  id: string;
  userId: string;
  name: string;
  icon: string;
  type: string; // 'fixed' | 'flexible' | 'plan'
  lifePlanId: string | null;
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
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [darkMode, setDarkMode] = useState(false);
  const [dbLanguage, setDbLanguage] = useState<string>('en');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAllocations = useCallback(async () => {
    try {
      const res = await fetch('/api/allocations', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load allocations');
      const data = await res.json();
      setAllocations(data.allocations);
      setMonthlyIncome(data.monthlyIncome);
      setDarkMode(data.darkMode ?? false);
      setDbLanguage(data.language ?? 'en');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAllocations(); }, [fetchAllocations]);

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
    return {};
  };

  const createAllocation = async (payload: {
    name: string;
    icon: string;
    type: string;
    allocatedAmount?: number;
    lifePlanId?: string | null;
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

  const updateAllocation = async (id: string, payload: Partial<Allocation>) => {
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

  const updateDarkMode = async (value: boolean) => {
    const res = await fetch('/api/allocations/settings/display', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ darkMode: value }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update display settings' };
    setDarkMode(data.darkMode);
    return {};
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

  const totalAllocated = allocations.reduce((s, a) => s + a.allocatedAmount, 0);
  const unallocated = Math.max(0, monthlyIncome - totalAllocated);

  return {
    allocations, monthlyIncome, darkMode, dbLanguage, loading, error, totalAllocated, unallocated,
    fetchAllocations, updateIncome, updateDarkMode, updateLanguage, createAllocation, updateAllocation, deleteAllocation, reorderAllocations,
    fetchSuggestedBudgets, applyBudgets,
  };
}
