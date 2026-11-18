import { useCallback, useEffect, useState } from 'react';

// Gastos hormiga (LPBETA-12): subscriptions (any recurring charge that isn't
// housing, utilities, insurance or a debt) and small frequent expenses (under
// 10 €, 4+ times in the month). Computed by the server over the movements this
// person may see (GET /api/insights/hormiga). Amounts in euros, as the API
// returns them.
export type Cadence = 'weekly' | 'monthly' | 'yearly';
export type SubscriptionDecision = 'keep' | 'cancel';

export interface HormigaSubscription {
  id: string | null;
  merchant: string;
  cadence: Cadence;
  amount: number;
  monthlyAmount: number;
  yearlyAmount: number;
  previousAmount: number | null; // the price before a rise
  isNew: boolean;
  lastDate: string;
  nextExpectedDate: string;
  decision: SubscriptionDecision | null;
  chargedAfterCancel: boolean;
}

export interface HormigaSmall {
  kind: 'merchant' | 'category';
  key: string;
  label: string;
  icon: string | null;
  count: number;
  amount: number;      // the average ticket
  total: number;       // this month
  yearlyTotal: number;
}

export interface HormigaTotals {
  subscriptionsMonthly: number;
  subscriptionsYearly: number;
  smallTotal: number;
  smallYearly: number;
  monthlyTotal: number;
  yearlyTotal: number;
  halfYearly: number;
}

export interface HormigaData {
  month: string;
  subscriptions: HormigaSubscription[];
  small: HormigaSmall[];
  totals: HormigaTotals;
}

export function useHormiga(month: string) {
  const [data, setData] = useState<HormigaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const fetchHormiga = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/insights/hormiga?month=${encodeURIComponent(month)}`, { credentials: 'include' });
      if (!res.ok) throw new Error('hormiga failed');
      const json = await res.json() as { data: HormigaData };
      setData(json.data);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchHormiga(); }, [fetchHormiga]);

  /** "La quiero" / "voy a cancelarla" (null takes it back); true when saved. */
  const decide = useCallback(async (id: string, decision: SubscriptionDecision | null): Promise<boolean> => {
    try {
      const res = await fetch(`/api/recurring/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) return false;
      setData(d => d && {
        ...d,
        subscriptions: d.subscriptions.map(s => s.id === id ? { ...s, decision, chargedAfterCancel: false } : s),
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  return { data, loading, failed, refresh: fetchHormiga, decide };
}

/** A merchant key ("cafe lopez") as a label ("Cafe lopez"). */
export function merchantLabel(merchant: string): string {
  return merchant.charAt(0).toUpperCase() + merchant.slice(1);
}
