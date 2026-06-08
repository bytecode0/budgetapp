import { useState, useEffect, useCallback } from 'react';
import type { Expense } from './useExpenses';

// Each group is a set of expenses that look like duplicates of each other
// (same amount, within a 2-day window).
export type DuplicateGroup = Expense[];

export function useDuplicates() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDuplicates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/expenses/duplicates', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load duplicates');
      const data = await res.json();
      setGroups(data.groups);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDuplicates(); }, [fetchDuplicates]);

  const merge = async (keepId: string, removeIds: string[]) => {
    const res = await fetch('/api/expenses/merge', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId, removeIds }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to merge' };
    await fetchDuplicates();
    return { removed: data.removed as number };
  };

  return { groups, loading, fetchDuplicates, merge };
}
