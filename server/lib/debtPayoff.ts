// Snowball / avalanche payoff simulation (Phase 4).
//
// Snowball orders debts smallest-balance-first (momentum/motivation); avalanche
// orders by highest APR first (mathematically optimal interest cost). Either
// way, the mechanism is identical: pay every debt's own minimum, then cascade
// whatever's left of a fixed monthly budget onto the highest-priority debt that
// still has a balance. Once a debt is paid off, its minimum is folded back into
// next month's cascade — that's the "snowball" (the payment grows as debts
// disappear), not a fixed sub-payment per debt.
export type PayoffMethod = "snowball" | "avalanche";

export interface PayoffDebtInput {
  id: string;
  currentBalance: number; // cents
  apr: number | null; // annual percentage, e.g. 21.9
  minimumPayment: number | null; // cents
  installmentAmount: number | null; // cents
}

export interface PayoffOrderEntry { id: string; monthPaidOff: number }
export interface PayoffSummary {
  method: PayoffMethod;
  months: number; // 0 if already debt-free; MAX_MONTHS if it never amortizes
  totalInterestPaid: number; // cents
  totalPaid: number; // cents (principal + interest)
  payoffOrder: PayoffOrderEntry[];
}

const MAX_MONTHS = 600; // 50-year safety cap against a budget that never amortizes

function monthlyRate(apr: number | null): number {
  if (!apr || apr <= 0) return 0;
  return apr / 100 / 12;
}

function priorityOrder(debts: PayoffDebtInput[], method: PayoffMethod): string[] {
  const copy = [...debts];
  if (method === "snowball") copy.sort((a, b) => a.currentBalance - b.currentBalance);
  else copy.sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0));
  return copy.map(d => d.id);
}

export function simulatePayoff(
  debts: PayoffDebtInput[],
  method: PayoffMethod,
  extraPaymentCents = 0,
): PayoffSummary {
  const balances = new Map(debts.map(d => [d.id, d.currentBalance]));
  const rates = new Map(debts.map(d => [d.id, monthlyRate(d.apr)]));
  const minimums = new Map(debts.map(d => [d.id, d.minimumPayment ?? d.installmentAmount ?? 0]));
  const order = priorityOrder(debts, method);
  // The fixed monthly budget the user commits to debt payoff. As debts close,
  // their minimum is no longer spent there — it rolls into the cascade below.
  const totalMonthlyBudget = [...minimums.values()].reduce((s, m) => s + m, 0) + extraPaymentCents;

  let totalInterestPaid = 0;
  let totalPaid = 0;
  const payoffOrder: PayoffOrderEntry[] = [];
  const paidOff = new Set<string>();

  let month = 0;
  while (month < MAX_MONTHS && [...balances.values()].some(b => b > 0)) {
    month += 1;

    // 1. Accrue interest on every open balance.
    for (const [id, bal] of balances) {
      if (bal <= 0) continue;
      const interest = Math.round(bal * (rates.get(id) ?? 0));
      balances.set(id, bal + interest);
      totalInterestPaid += interest;
    }

    // 2. Pay each open debt's own minimum.
    let budgetUsed = 0;
    for (const [id, bal] of balances) {
      if (bal <= 0) continue;
      const min = Math.min(bal, minimums.get(id) ?? 0);
      balances.set(id, bal - min);
      totalPaid += min;
      budgetUsed += min;
    }

    // 3. Cascade whatever's left of the fixed budget onto the top-priority debt.
    let remaining = totalMonthlyBudget - budgetUsed;
    for (const id of order) {
      if (remaining <= 0) break;
      const bal = balances.get(id)!;
      if (bal <= 0) continue;
      const pay = Math.min(bal, remaining);
      balances.set(id, bal - pay);
      totalPaid += pay;
      remaining -= pay;
    }

    // 4. Record any debt that just hit zero, in priority order.
    for (const id of order) {
      if (!paidOff.has(id) && (balances.get(id) ?? 0) <= 0) {
        paidOff.add(id);
        payoffOrder.push({ id, monthPaidOff: month });
      }
    }
  }

  return { method, months: month, totalInterestPaid, totalPaid, payoffOrder };
}
