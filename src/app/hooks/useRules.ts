import { useState, useEffect, useCallback } from 'react';

export interface RuleAllocation {
  id: string;
  name: string;
  icon: string;
  type: string;
}

export interface CategorizationRule {
  id: string;
  matchType: 'contains' | 'equals' | 'regex';
  pattern: string;
  allocationId: string;
  priority: number;
  source: 'manual' | 'learned';
  allocation: RuleAllocation | null;
}

export function useRules() {
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rules', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load rules');
      const data = await res.json();
      setRules(data.rules);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const createRule = async (payload: {
    matchType: string;
    pattern: string;
    allocationId: string;
    priority?: number;
  }) => {
    const res = await fetch('/api/rules', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create rule' };
    setRules(prev => [...prev, data.rule]);
    return { rule: data.rule };
  };

  const updateRule = async (id: string, payload: Partial<Omit<CategorizationRule, 'id' | 'allocation' | 'source'>>) => {
    const res = await fetch(`/api/rules/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update rule' };
    setRules(prev => prev.map(r => (r.id === id ? data.rule : r)));
    return { rule: data.rule };
  };

  const deleteRule = async (id: string) => {
    const res = await fetch(`/api/rules/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) return { error: 'Failed to delete rule' };
    setRules(prev => prev.filter(r => r.id !== id));
    return {};
  };

  return { rules, loading, error, fetchRules, createRule, updateRule, deleteRule };
}
