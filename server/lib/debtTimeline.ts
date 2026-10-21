// The "committed future" timeline (Phase 3) — the product's core differentiator.
// Instead of "where did my money go", this answers "how much of what's coming
// in is already spoken for". Pure function over a debt list + monthly income,
// built on the same period math as the rest of the app (server/lib/period.ts)
// so it respects the user's payday, not just the calendar month.
import { periodKeyOffset, currentPeriodKey } from "./period.js";

export interface TimelineDebtInput {
  id: string;
  name: string;
  kind: string;
  status: string;
  minimumPayment: number | null; // cents
  installmentAmount: number | null; // cents
  installmentsTotal: number | null;
  installmentsPaid: number | null;
  // Optional so callers that predate payment modes keep their behavior.
  paymentMode?: string;
  previousRemaining?: number; // cents — pre-existing debt left (server/lib/debtBalance.ts)
}

export interface TimelinePeriodItem { debtId: string; name: string; kind: string; amount: number }
export interface TimelinePeriod {
  period: string;
  committed: number;
  expectedIncome: number;
  pctCommitted: number; // 0-100+, one decimal
  items: TimelinePeriodItem[];
}

// A revolving debt (credit card) or one with no known term keeps recurring
// every period while active. An installment plan drops off once its
// remaining installments run out.
function stillDueAt(d: TimelineDebtInput, periodsAhead: number): boolean {
  if (d.installmentsTotal == null) return true;
  const paid = d.installmentsPaid ?? 0;
  return paid + periodsAhead < d.installmentsTotal;
}

export function buildDebtTimeline(
  debts: TimelineDebtInput[],
  monthlyIncomeCents: number,
  cycleStartDay: number,
  periodsCount: number,
): TimelinePeriod[] {
  const current = currentPeriodKey(cycleStartDay);
  const active = debts.filter(d => d.status === "active");

  const out: TimelinePeriod[] = [];
  for (let i = 0; i < periodsCount; i++) {
    const period = periodKeyOffset(current, i);
    const items: TimelinePeriodItem[] = [];
    for (const d of active) {
      // Paid in full: only the pre-existing debt is committed, once, now. New
      // card purchases are already budgeted spending, not a future commitment.
      const amount = d.paymentMode === "full"
        ? (i === 0 ? d.previousRemaining ?? 0 : 0)
        : d.minimumPayment ?? d.installmentAmount ?? 0;
      if (amount <= 0) continue;
      if (!stillDueAt(d, i)) continue;
      items.push({ debtId: d.id, name: d.name, kind: d.kind, amount });
    }
    const committed = items.reduce((s, it) => s + it.amount, 0);
    const pctCommitted = monthlyIncomeCents > 0
      ? Math.round((committed / monthlyIncomeCents) * 1000) / 10
      : 0;
    out.push({ period, committed, expectedIncome: monthlyIncomeCents, pctCommitted, items });
  }
  return out;
}
