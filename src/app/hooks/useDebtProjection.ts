import { useEffect, useState } from 'react';
import type { DebtKind, DebtPaymentMode, DebtStatus, PayoffMethod } from './useDebts';

// The debt detail and payoff plan screens (LPBETA-02): GET /api/debts/:id/detail
// and GET /api/debts/plan. Amounts in euros (the server converts from cents).
// The simulator is only for looking: these calls never write anything.

export type MissingField = 'apr' | 'minimum';
export interface MonthPoint { month: string; owed: number } // "YYYY-MM", euros

export interface Scenario {
  months: number;
  converged: boolean;
  payoffMonth: string | null;
  totalInterestPaid: number;
  totalPaid: number;
}

export interface DebtDetailData {
  debt: {
    id: string; name: string; kind: DebtKind; status: DebtStatus; paymentMode: DebtPaymentMode;
    apr: number | null; minimumPayment: number | null; installmentAmount: number | null;
    ownerUserId: string; accountId: string | null;
    owed: number; paymentsTotal: number; purchasesTotal: number;
  };
  startMonth: string;
  assumesNoNewPurchases: boolean;
  past: MonthPoint[];
  projection: {
    status: 'ok' | 'paid_in_full' | 'nothing_owed' | 'needs_data';
    missing: MissingField[];
    base: (Scenario & { series: MonthPoint[] }) | null;
    simulated: (Scenario & { series: MonthPoint[] }) | null;
  };
  history: { id: string; type: 'payment' | 'purchase' | 'refund' | 'adjustment'; amount: number; date: string; description: string | null }[];
}

export interface PayoffPlanData {
  method: PayoffMethod;
  startMonth: string;
  included: { id: string; name: string; kind: DebtKind; owed: number; apr: number | null; minimumPayment: number }[];
  excluded: { id: string; name: string; kind: DebtKind; reason: 'paid_in_full' | 'needs_data'; missing: MissingField[] }[];
  plan: (Scenario & {
    payoffOrder: { id: string; name: string; monthPaidOff: number; payoffMonth: string }[];
    series: (MonthPoint & { debts: { id: string; owed: number }[] })[];
  }) | null;
  other: (Scenario & { method: PayoffMethod }) | null;
  minimumsOnly: (Scenario & { series: MonthPoint[] }) | null;
}

export interface SimulatorParams {
  method?: PayoffMethod;
  extra?: number; // euros
  oneOff?: number; // euros
  oneOffMonth?: string; // "YYYY-MM"
}

const euros = (v: number | undefined) => String(Math.round(Math.max(0, v ?? 0) * 100) / 100);

function query(p: SimulatorParams): string {
  const q = new URLSearchParams({ extra: euros(p.extra) });
  if (p.method) q.set('method', p.method);
  if ((p.oneOff ?? 0) > 0 && p.oneOffMonth) {
    q.set('oneOff', euros(p.oneOff));
    q.set('oneOffMonth', p.oneOffMonth);
  }
  return q.toString();
}

// Fetches `path` whenever the key changes, after a short pause so typing in
// the simulator doesn't send a request per keystroke. The last answer stays
// on screen while the next one loads.
function useLive<T>(path: string | null, refreshKey: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(path, { credentials: 'include', signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        setData(body.data as T);
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { ctrl.abort(); window.clearTimeout(timer); };
  }, [path, refreshKey]);

  return { data, loading, failed };
}

export function useDebtDetail(debtId: string, sim: SimulatorParams, refreshKey = 0) {
  return useLive<DebtDetailData>(`/api/debts/${encodeURIComponent(debtId)}/detail?${query(sim)}`, refreshKey);
}

export function usePayoffPlan(sim: SimulatorParams) {
  return useLive<PayoffPlanData>(`/api/debts/plan?${query(sim)}`, 0);
}

/** "YYYY-MM" → "noviembre de 2026" / "nov 26" in the user's locale. */
export function monthLabel(key: string, locale: string, short = false): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, short
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The month after `key`, as an <input type="month"> min. */
export function nextMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

// Debt colours in the charts: the design system's chart tokens (light and
// dark in src/styles/theme.css), in fixed order by the debt's place in the
// list. A sixth debt and beyond fold into "others".
export const DEBT_CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
