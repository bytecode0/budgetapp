import { useCallback, useEffect, useState } from 'react';

// "¿Cómo te sientes hoy con tu dinero?" (LPBETA-24): my answers, one per
// budget period, 1 (muy intranquilo) to 5 (en paz). Private: the server only
// ever returns the signed-in person's own (GET/POST /api/checkins).
export interface PeaceCheckin { period: string; score: number; createdAt: string }
export interface PeaceState {
  period: string;          // this budget period, "YYYY-MM"
  current: number | null;  // my answer this period
  ask: boolean;            // no answer yet this period
  checkins: PeaceCheckin[]; // oldest period first
}

export function usePeaceCheckins() {
  const [state, setState] = useState<PeaceState | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/checkins', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (alive && json?.data) setState(json.data); })
      .catch(() => { /* the card just doesn't show */ });
    return () => { alive = false; };
  }, []);

  /** Saves this period's answer; true when saved. */
  const answer = useCallback(async (score: number): Promise<boolean> => {
    try {
      const res = await fetch('/api/checkins', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score }),
      });
      if (!res.ok) return false;
      const { data } = await res.json() as { data: PeaceCheckin };
      setState(s => s && {
        ...s,
        current: data.score,
        ask: false,
        checkins: [...s.checkins.filter(c => c.period !== data.period), data].sort((a, b) => a.period.localeCompare(b.period)),
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  return { state, answer };
}
