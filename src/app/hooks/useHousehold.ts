import { useState, useEffect, useCallback } from 'react';

export type FinancialModel = 'individual' | 'proportional' | 'shared';
export type VisibilityTier = 'transparent' | 'shared_stats' | 'global_only';

export interface HouseholdMember {
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: 'owner' | 'member';
  status: string;
  contributionBasis: 'income' | 'equal' | 'custom';
  customSharePct: number | null;
}

export interface Household {
  id: string;
  name: string;
  financialModel: FinancialModel;
  visibilityTier: VisibilityTier;
  baseCurrency: string;
  members: HouseholdMember[];
}

export function useHousehold() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHousehold = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/households/current', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setHousehold(data.household ?? null);
    } catch {
      setHousehold(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHousehold(); }, [fetchHousehold]);

  const updateHousehold = async (patch: Partial<Pick<Household, 'name' | 'financialModel' | 'visibilityTier'>>) => {
    if (!household) return { error: 'No household' };
    const res = await fetch(`/api/households/${household.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update household' };
    setHousehold(data.household);
    return { household: data.household as Household };
  };

  return { household, loading, fetchHousehold, updateHousehold };
}
