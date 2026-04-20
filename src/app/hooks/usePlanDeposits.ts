import { useState, useEffect, useCallback } from 'react';

export interface DepositPlan {
  id: string;
  title: string;
  icon: string;
  color: string;
  targetAmount: number;
  currentAmount: number;
}

export interface PlanDeposit {
  id: string;
  planId: string;
  month: string;
  amount: number;
  note: string;
  plan: DepositPlan;
}

export function usePlanDeposits(month: string) {
  const [deposits, setDeposits] = useState<PlanDeposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/plan-deposits?month=${month}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load deposits');
      const data = await res.json();
      setDeposits(data.deposits);
    } catch {
      setDeposits([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchDeposits(); }, [fetchDeposits]);

  const confirmDeposits = async (
    entries: { planId: string; amount: number; note?: string }[]
  ) => {
    setConfirming(true);
    try {
      const res = await fetch('/api/plan-deposits/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, deposits: entries }),
      });
      const data = await res.json();
      if (!res.ok) return { error: data.error || 'Failed to confirm' };
      setDeposits(data.deposits);
      return { deposits: data.deposits };
    } catch {
      return { error: 'Network error' };
    } finally {
      setConfirming(false);
    }
  };

  const isConfirmed = deposits.length > 0;

  return { deposits, loading, confirming, isConfirmed, fetchDeposits, confirmDeposits };
}
