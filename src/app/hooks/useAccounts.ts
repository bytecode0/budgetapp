import { useState, useEffect, useCallback } from 'react';

export type AccountType = 'checking' | 'savings' | 'cash' | 'investment' | 'card';

export type CardPaymentMode = 'full' | 'minimum';

// The debt behind a card account (server/lib/cardDebt.ts) — created and kept
// in step by the server; the user only ever edits the card.
export interface CardInfo {
  debtId: string;
  paymentMode: CardPaymentMode;
  minimumPayment: number | null; // euros
  paymentDueDay: number | null;
  owed: number; // euros — live: purchases raise it, payments lower it
  monthlyCommitment: number; // euros — this period's budget line
}

// Card settings sent along with a card account. For a card, currentBalance
// means what's owed now.
export interface CardSettingsPayload {
  cardPaymentMode?: CardPaymentMode;
  cardMinimumPayment?: number | null;
  cardPaymentDueDay?: number | null;
}

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
  visibility?: 'private' | 'household'; // Epic H2
  householdId?: string | null;
  card?: CardInfo | null;
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
    visibility?: 'private' | 'household';
  } & CardSettingsPayload) => {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create account' };
    // A card's debt info is only in the listing — refetch to get it.
    if (data.account.type === 'card') { await fetchAccounts(); return { account: data.account }; }
    setAccounts((a) => [...a, data.account]);
    setNetWorth((n) => n + (data.account.isArchived ? 0 : data.account.currentBalance));
    return { account: data.account };
  };

  const updateAccount = async (id: string, payload: Partial<Omit<Account, 'card'>> & CardSettingsPayload) => {
    const res = await fetch(`/api/accounts/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update account', code: data.code as string | undefined };
    if (data.account.type === 'card' || payload.type !== undefined) { await fetchAccounts(); return { account: data.account }; }
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
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { error: (data.error as string) || 'Failed to delete account', code: data.code as string | undefined };
    }
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
