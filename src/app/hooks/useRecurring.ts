import { useState, useEffect, useCallback } from 'react';

export type RecurringStatus = 'detected' | 'confirmed' | 'ignored';

export interface RecurringAllocation {
  id: string;
  name: string;
  icon: string;
  type: string;
}

export interface RecurringCommitment {
  id: string;
  userId: string;
  merchant: string;
  avgAmount: number; // euros
  cadence: string; // "monthly"
  allocationId: string | null;
  nextExpectedDate: string | null;
  status: RecurringStatus;
  allocation: RecurringAllocation | null;
}

export function useRecurring() {
  const [commitments, setCommitments] = useState<RecurringCommitment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecurring = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/recurring', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load recurring');
      const data = await res.json();
      setCommitments(data.commitments);
    } catch {
      setCommitments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecurring(); }, [fetchRecurring]);

  const update = async (id: string, payload: { status?: RecurringStatus; allocationId?: string | null }) => {
    const res = await fetch(`/api/recurring/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update' };
    setCommitments(prev => prev.map(c => c.id === id ? data.commitment : c));
    return { commitment: data.commitment };
  };

  return { commitments, loading, fetchRecurring, update };
}
