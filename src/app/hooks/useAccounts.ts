import { useState, useEffect, useCallback } from 'react';

export type AccountType = 'checking' | 'savings' | 'cash' | 'investment' | 'card';

export interface Account {
  id: string;
  userId: string;
  ownerUserId: string;
  name: string;
  type: AccountType;
  currency: string;
  currentBalance: number; // euros
  isArchived: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [netWorth, setNetWorth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/accounts', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = await res.json();
      setAccounts(data.accounts);
      setNetWorth(data.netWorth);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const createAccount = async (payload: {
    name: string;
    type?: AccountType;
    currency?: string;
    currentBalance?: number;
  }) => {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create account' };
    setAccounts((a) => [...a, data.account]);
    setNetWorth((n) => n + (data.account.isArchived ? 0 : data.account.currentBalance));
    return { account: data.account };
  };

  const updateAccount = async (id: string, payload: Partial<Account>) => {
    const res = await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update account' };
    // Balance / archived may have changed — recompute net worth from the new set.
    setAccounts((a) => {
      const next = a.map((x) => (x.id === id ? data.account : x));
      setNetWorth(next.filter((x) => !x.isArchived).reduce((s, x) => s + x.currentBalance, 0));
      return next;
    });
    return { account: data.account };
  };

  const deleteAccount = async (id: string) => {
    const res = await fetch(`/api/accounts/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) return { error: 'Failed to delete account' };
    setAccounts((a) => {
      const next = a.filter((x) => x.id !== id);
      setNetWorth(next.filter((x) => !x.isArchived).reduce((s, x) => s + x.currentBalance, 0));
      return next;
    });
    return {};
  };

  const reorderAccounts = async (order: { id: string; sortOrder: number }[]) => {
    const res = await fetch('/api/accounts/reorder', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order }),
    });
    if (!res.ok) return { error: 'Failed to reorder' };
    return {};
  };

  return {
    accounts, netWorth, loading, error,
    fetchAccounts, createAccount, updateAccount, deleteAccount, reorderAccounts,
  };
}
