import { useCallback, useEffect, useState } from 'react';

// Home's "Te has pagado X de Y este mes" (GET /api/dashboard/month,
// server/lib/payYourselfFirst.ts). Amounts in euros, as the API returns them.
export interface MonthSavings {
  month: string;
  householdIncome: number;
  paidYourself: number;
  payYourselfFirstBps: number | null;
  payYourselfFirstGoal: number | null;
  payYourselfFirstApplies: boolean; // false: the share was chosen after this month ended
  generosityAmount: number; // "Das X al mes" (LPBETA-10)
  generosityBps: number | null;
}

export function useMonthSavings(month: string) {
  const [savings, setSavings] = useState<MonthSavings | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/dashboard/month?month=${encodeURIComponent(month)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load');
      const { data } = await res.json();
      setSavings(data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [month]);

  useEffect(() => { refresh(); }, [refresh]);

  return { savings, failed, refresh };
}
