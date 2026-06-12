import { useState, useEffect, useCallback } from 'react';

export interface ExpenseAllocation {
  id: string;
  name: string;
  icon: string;
  type: string;
}

export interface ExpenseAccount {
  id: string;
  name: string;
  type: string;
}

export interface Expense {
  id: string;
  userId: string;
  allocationId: string | null;
  accountId: string | null;
  amount: number;
  description: string;
  merchant: string;
  source: string; // "manual" | "import"
  externalId: string | null;
  date: string;
  allocation: ExpenseAllocation | null;
  account: ExpenseAccount | null;
}

export function useExpenses(month?: string) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExpenses = useCallback(async (m?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (m) params.set('month', m);
      const res = await fetch(`/api/expenses?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load expenses');
      const data = await res.json();
      setExpenses(data.expenses);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchExpenses(month); }, [fetchExpenses, month]);

  const createExpense = async (payload: {
    amount: number;
    description?: string;
    allocationId?: string | null;
    accountId?: string | null;
    date?: string;
  }) => {
    const res = await fetch('/api/expenses', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create expense' };
    setExpenses(prev => [data.expense, ...prev]);
    return { expense: data.expense };
  };

  // Ask the rules engine which category it would assign for this description.
  // Returns null when nothing matches. Used for the live suggestion in AddExpense.
  const suggestAllocation = async (description: string) => {
    const q = description.trim();
    if (!q) return null;
    try {
      const res = await fetch(`/api/expenses/suggest?description=${encodeURIComponent(q)}`, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.suggestion as { allocationId: string; name: string; icon: string } | null;
    } catch {
      return null;
    }
  };

  const updateExpense = async (id: string, payload: Partial<Omit<Expense, 'id' | 'userId'>>) => {
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update expense' };
    setExpenses(prev => prev.map(e => e.id === id ? data.expense : e));
    return { expense: data.expense };
  };

  const deleteExpense = async (id: string) => {
    const res = await fetch(`/api/expenses/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) return { error: 'Failed to delete expense' };
    setExpenses(prev => prev.filter(e => e.id !== id));
    return {};
  };

  // Total spent this month grouped by allocationId
  const totalByAllocation = expenses.reduce<Record<string, number>>((acc, e) => {
    const key = e.allocationId ?? '__unassigned__';
    acc[key] = (acc[key] ?? 0) + e.amount;
    return acc;
  }, {});

  const totalSpent = expenses.reduce((s, e) => s + e.amount, 0);

  return {
    expenses, loading, error,
    totalSpent, totalByAllocation,
    fetchExpenses, createExpense, updateExpense, deleteExpense, suggestAllocation,
  };
}
