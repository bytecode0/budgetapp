import { useState, useEffect, useCallback } from 'react';

export interface LifePlan {
  id: string;
  userId: string;
  title: string;
  description: string;
  goalClass: string; // 'safety' | 'savings' | 'investment' | 'wealth'
  type: string;
  icon: string;
  color: string;
  targetAmount: number;
  currentAmount: number;
  monthlyContribution: number;
  deadline: string | null;
  milestones: string; // JSON array of milestone amounts, e.g. "[5000,10000,50000]"
  createdAt: string;
  updatedAt: string;
}

export type PlanStatus = 'on-track' | 'ahead' | 'behind' | 'completed';

export function getPlanStatus(plan: LifePlan): PlanStatus {
  if (plan.currentAmount >= plan.targetAmount) return 'completed';
  if (!plan.deadline) return 'on-track';
  const totalDays = (new Date(plan.deadline).getTime() - new Date(plan.createdAt).getTime()) / 86400000;
  const elapsedDays = (Date.now() - new Date(plan.createdAt).getTime()) / 86400000;
  if (totalDays <= 0) return 'on-track';
  const expectedProgress = Math.min(elapsedDays / totalDays, 1);
  const actualProgress = plan.currentAmount / plan.targetAmount;
  if (actualProgress >= expectedProgress + 0.05) return 'ahead';
  if (actualProgress < expectedProgress - 0.1) return 'behind';
  return 'on-track';
}

export function usePlans() {
  const [plans, setPlans] = useState<LifePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/plans', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load plans');
      const data = await res.json();
      setPlans(data.plans);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const createPlan = async (payload: {
    title: string;
    description?: string;
    goalClass?: string;
    type: string;
    icon: string;
    color: string;
    targetAmount: number;
    currentAmount?: number;
    monthlyContribution?: number;
    deadline?: string;
    autoCreateAllocation?: boolean;
  }) => {
    const res = await fetch('/api/plans', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to create plan' };
    setPlans((p) => [...p, data.plan]);
    return { plan: data.plan, allocation: data.allocation ?? null };
  };

  const updatePlan = async (id: string, payload: Partial<LifePlan>) => {
    const res = await fetch(`/api/plans/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to update plan' };
    setPlans((p) => p.map((x) => (x.id === id ? data.plan : x)));
    return { plan: data.plan, allocationOutOfSync: data.allocationOutOfSync ?? false, linkedAllocationId: data.linkedAllocationId ?? null };
  };

  const deletePlan = async (id: string) => {
    const res = await fetch(`/api/plans/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) return { error: 'Failed to delete plan' };
    setPlans((p) => p.filter((x) => x.id !== id));
    return {};
  };

  const contributeToPlan = async (id: string, amount: number) => {
    const res = await fetch(`/api/plans/${id}/contribute`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to add contribution' };
    setPlans((p) => p.map((x) => (x.id === id ? data.plan : x)));
    return { plan: data.plan };
  };

  return { plans, loading, error, fetchPlans, createPlan, updatePlan, deletePlan, contributeToPlan };
}
