// The "committed future" timeline (Phase 3) — the product's core differentiator.
// Instead of "where did my money go", this answers "how much of what's coming
// in is already spoken for". Pure function over a debt list + monthly income,
// built on the same period math as the rest of the app (server/lib/period.ts)
// so it respects the user's payday, not just the calendar month.
import { periodKeyOffset, currentPeriodKey } from "./period.js";
import { debtState, monthlyCommitment, previousPaidBefore, type DebtLedger } from "./debtBalance.js";
import { cycleDaysOf, previousDueBefore } from "./cardCycle.js";

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
  // A card paid in full with a billing cycle: what each period commits
  // (timelineInput). Index 0 is the current period. Overrides the
  // payment-mode rule.
  cycleAmounts?: number[];
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

/** A debt's timeline input from its ledger, for `periods` (`periods[0]` is
 *  the current one). Measured at the period's start, like the budget line,
 *  so paying during this period doesn't make the commitment vanish from it:
 *  the current period always commits exactly what the debt's budget line
 *  holds (monthlyCommitment), cycle or not.
 *  A card paid in full with a billing cycle (server/lib/cardCycle.ts, rule 5)
 *  also commits, in later periods, the pre-existing debt that falls due then
 *  — never its purchases, already spending in their categories. What earlier
 *  periods commit counts as paid, unless the payments recorded already paid
 *  more of that debt. Without a cycle, a card paid in full commits nothing
 *  after the current period, as before. */
export function timelineInput<T extends TimelineDebtInput>(
  d: T, ledger: DebtLedger, periods: { start: Date; end: Date }[],
): T {
  const current = periods[0];
  const line = monthlyCommitment(ledger, current);
  const base = { ...d, installmentsPaid: debtState(ledger, current.start).installmentsPaid, previousRemaining: line };
  const days = ledger.debt.paymentMode === "full" ? cycleDaysOf(ledger.debt) : null;
  if (!days) return base;

  const paidBeforeStart = previousPaidBefore(ledger, current.start);
  const paidAll = previousPaidBefore(ledger);
  let committed = line;
  const cycleAmounts = periods.map((p, i) => {
    if (i === 0) return line;
    const amount = Math.max(0, previousDueBefore(ledger, p.end, days) - Math.max(paidAll, paidBeforeStart + committed));
    committed += amount;
    return amount;
  });
  return { ...base, cycleAmounts };
}

export function buildDebtTimeline(
  debts: TimelineDebtInput[],
  monthlyIncomeCents: number,
  cycleStartDay: number,
  periodsCount: number,
  now: Date = new Date(),
): TimelinePeriod[] {
  const current = currentPeriodKey(cycleStartDay, now);
  const active = debts.filter(d => d.status === "active");

  const out: TimelinePeriod[] = [];
  for (let i = 0; i < periodsCount; i++) {
    const period = periodKeyOffset(current, i);
    const items: TimelinePeriodItem[] = [];
    for (const d of active) {
      // A card paid in full with a billing cycle: its pre-existing debt in the
      // period it falls due (timelineInput). Without one: only the
      // pre-existing debt, once, now. Never its purchases — they're already
      // budgeted spending.
      const amount = d.cycleAmounts
        ? d.cycleAmounts[i] ?? 0
        : d.paymentMode === "full"
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
