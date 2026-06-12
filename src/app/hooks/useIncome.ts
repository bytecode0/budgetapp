import { useState, useEffect, useCallback } from 'react';

export type IncomeCategory = 'salary' | 'freelance' | 'transfer_in' | 'other';

export interface IncomeAccount {
  id: string;
  name: string;
  type: string;
}

export interface Income {
  id: string;
  userId: string;
  ownerUserId: string;
  accountId: string | null;
  amount: number;
  description: string;
  merchant: string;
  category: IncomeCategory;
  source: string; // "manual" | "import"
  externalId: string | null;
  date: string;
  account: IncomeAccount | null;
}

export function useIncome(month?: string) {
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIncomes = useCallback(async (m?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (m) params.set('month', m);
      const res = await fetch(`/api/income?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load income');
      const data = await res.json();
      setIncomes(data.incomes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchIncomes(month); }, [fetchIncomes, month]);

  const createIncome = async (payload: {
    amount: number;
    description?: string;
    category?: IncomeCategory;
    accountId?: string | null;
    date?: string;
  }) => {
    const res = await fetch('/api/income', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create income' };
    setIncomes(prev => [data.income, ...prev]);
    return { income: data.income };
  };

  const updateIncome = async (id: string, payload: Partial<Omit<Income, 'id' | 'userId'>>) => {
    const res = await fetch(`/api/income/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update income' };
    setIncomes(prev => prev.map(i => i.id === id ? data.income : i));
    return { income: data.income };
  };

  const deleteIncome = async (id: string) => {
    const res = await fetch(`/api/income/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) return { error: 'Failed to delete income' };
    setIncomes(prev => prev.filter(i => i.id !== id));
    return {};
  };

  const totalIncome = incomes.reduce((s, i) => s + i.amount, 0);

  return {
    incomes, loading, error, totalIncome,
    fetchIncomes, createIncome, updateIncome, deleteIncome,
  };
}
