import { useCallback, useEffect, useState } from 'react';

// "Celebrar los hitos" (LPBETA-13): the celebrations I haven't seen yet,
// biggest first (GET /api/celebrations, server/lib/celebrations.ts). Amounts in
// euros, as the API returns them. Seen is remembered by the server, per person,
// so a closed card never comes back on another device.
export type Celebration =
  | { key: string; kind: 'debtPaidOff'; name: string; amount: number | null } // freed per month
  | { key: string; kind: 'emergencyFundDone'; title: string }
  | { key: string; kind: 'planDone'; title: string }
  | { key: string; kind: 'planMilestone'; title: string; pct: number | null; amount: number | null }
  | { key: string; kind: 'planFirstContribution'; title: string }
  | { key: string; kind: 'payYourselfFirstFirst' }
  | { key: string; kind: 'payYourselfFirstStreak'; months: number }
  | { key: string; kind: 'monthWithinBudget'; month: string };

export function useCelebrations() {
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/celebrations', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (alive && json?.data) setCelebrations(json.data.celebrations); })
      .catch(() => { /* nothing to celebrate shown */ });
    return () => { alive = false; };
  }, []);

  /** Marks one as seen; true when saved. */
  const markSeen = useCallback(async (key: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/celebrations/seen', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) return false;
      setCelebrations(list => list.filter(c => c.key !== key));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { celebrations, markSeen };
}
