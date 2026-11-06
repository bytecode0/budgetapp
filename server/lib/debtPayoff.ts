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
  // An installment plan with a known count: the payment numbered
  // `paymentsLeft` settles the whole remaining balance (the last cuota may be
  // smaller), so the plan ends exactly after its remaining cuotas.
  paymentsLeft?: number | null;
  // Already paid this month: simulated month 1 neither accrues interest nor
  // pays it; it starts in month 2.
  skipFirstMonth?: boolean;
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

export interface PayoffOptions {
  extraPaymentCents?: number; // every month, on top of the minimums
  // A one-off payment (e.g. the June bonus) in simulated month `month` (≥ 1),
  // cascaded like the extra.
  oneOff?: { month: number; amountCents: number } | null;
  // false = "solo mínimos": each debt pays only its own minimum; nothing
  // cascades (no extra, no one-off, no freed minimums).
  cascade?: boolean;
}

export interface PayoffDebtMonth { id: string; owed: number; paidInMonth: number; interestInMonth: number } // cents
export interface PayoffMonth {
  month: number; // 1-based simulated month
  owed: number; // cents, every debt's balance at the end of the month
  paidInMonth: number; // cents
  interestInMonth: number; // cents
  debts: PayoffDebtMonth[]; // in input order
}
export interface PayoffDebtResult { id: string; monthPaidOff: number | null; interestPaid: number; totalPaid: number }
export interface PayoffSeries extends PayoffSummary {
  converged: boolean; // false: hit MAX_MONTHS with something still owed
  series: PayoffMonth[];
  perDebt: PayoffDebtResult[]; // in input order
}

export { MAX_MONTHS as PAYOFF_MAX_MONTHS };

/** The summary only (GET /api/debts/payoff). */
export function simulatePayoff(
  debts: PayoffDebtInput[],
  method: PayoffMethod,
  extraPaymentCents = 0,
): PayoffSummary {
  const { months, totalInterestPaid, totalPaid, payoffOrder } = simulatePayoffSeries(debts, method, { extraPaymentCents });
  return { method, months, totalInterestPaid, totalPaid, payoffOrder };
}

/** The month-by-month simulation behind every payoff chart and simulator
 *  (LPBETA-02). Integer cents throughout: interest is rounded once per debt
 *  and month, at accrual, so every figure is a sum of whole cents. */
export function simulatePayoffSeries(
  debts: PayoffDebtInput[],
  method: PayoffMethod,
  options: PayoffOptions = {},
): PayoffSeries {
  const extraPaymentCents = Math.max(0, options.extraPaymentCents ?? 0);
  const cascade = options.cascade ?? true;
  const oneOff = options.oneOff && options.oneOff.amountCents > 0 && options.oneOff.month >= 1 ? options.oneOff : null;
  const balances = new Map(debts.map(d => [d.id, d.currentBalance]));
  const rates = new Map(debts.map(d => [d.id, monthlyRate(d.apr)]));
  const minimums = new Map(debts.map(d => [d.id, d.minimumPayment ?? d.installmentAmount ?? 0]));
  const paymentsLeft = new Map(debts.map(d => [d.id, d.paymentsLeft ?? null]));
  const paymentsMade = new Map(debts.map(d => [d.id, 0]));
  const skipsFirst = new Set(debts.filter(d => d.skipFirstMonth).map(d => d.id));
  const order = priorityOrder(debts, method);
  // The fixed monthly budget the user commits to debt payoff. As debts close,
  // their minimum is no longer spent there — it rolls into the cascade below.
  // A debt already paid this month has spent its minimum: month 1's budget
  // leaves it out.
  const totalMonthlyBudget = [...minimums.values()].reduce((s, m) => s + m, 0) + extraPaymentCents;
  const skippedMinimums = [...skipsFirst].reduce((s, id) => s + (minimums.get(id) ?? 0), 0);

  let totalInterestPaid = 0;
  let totalPaid = 0;
  const payoffOrder: PayoffOrderEntry[] = [];
  const paidOff = new Set<string>();
  const perDebt = new Map(debts.map(d => [d.id, { id: d.id, monthPaidOff: null as number | null, interestPaid: 0, totalPaid: 0 }]));
  const series: PayoffMonth[] = [];

  let month = 0;
  while (month < MAX_MONTHS && [...balances.values()].some(b => b > 0)) {
    month += 1;
    const paidNow = new Map<string, number>();
    const interestNow = new Map<string, number>();
    const pay = (id: string, amount: number) => {
      balances.set(id, balances.get(id)! - amount);
      paidNow.set(id, (paidNow.get(id) ?? 0) + amount);
      totalPaid += amount;
    };

    const skipped = (id: string) => month === 1 && skipsFirst.has(id);

    // 1. Accrue interest on every open balance.
    for (const [id, bal] of balances) {
      if (bal <= 0 || skipped(id)) continue;
      const interest = Math.round(bal * (rates.get(id) ?? 0));
      balances.set(id, bal + interest);
      interestNow.set(id, interest);
      totalInterestPaid += interest;
    }

    // 2. Pay each open debt's own minimum (the whole rest on its last cuota).
    let budgetUsed = 0;
    for (const [id, bal] of balances) {
      if (bal <= 0 || skipped(id)) continue;
      const made = paymentsMade.get(id)! + 1;
      paymentsMade.set(id, made);
      const left = paymentsLeft.get(id);
      const min = left != null && made >= left ? bal : Math.min(bal, minimums.get(id) ?? 0);
      pay(id, min);
      budgetUsed += min;
    }

    // 3. Cascade whatever's left of the fixed budget (plus this month's
    //    one-off) onto the top-priority debt.
    if (cascade) {
      let remaining = totalMonthlyBudget - (month === 1 ? skippedMinimums : 0) - budgetUsed + (oneOff && oneOff.month === month ? oneOff.amountCents : 0);
      for (const id of order) {
        if (remaining <= 0) break;
        const bal = balances.get(id)!;
        if (bal <= 0 || skipped(id)) continue;
        const amount = Math.min(bal, remaining);
        pay(id, amount);
        remaining -= amount;
      }
    }

    // 4. Record any debt that just hit zero, in priority order.
    for (const id of order) {
      if (!paidOff.has(id) && (balances.get(id) ?? 0) <= 0) {
        paidOff.add(id);
        payoffOrder.push({ id, monthPaidOff: month });
        perDebt.get(id)!.monthPaidOff = month;
      }
    }

    const row: PayoffDebtMonth[] = debts.map(d => {
      const r = perDebt.get(d.id)!;
      const paidInMonth = paidNow.get(d.id) ?? 0;
      const interestInMonth = interestNow.get(d.id) ?? 0;
      r.totalPaid += paidInMonth;
      r.interestPaid += interestInMonth;
      return { id: d.id, owed: Math.max(0, balances.get(d.id)!), paidInMonth, interestInMonth };
    });
    series.push({
      month,
      owed: row.reduce((s, r) => s + r.owed, 0),
      paidInMonth: row.reduce((s, r) => s + r.paidInMonth, 0),
      interestInMonth: row.reduce((s, r) => s + r.interestInMonth, 0),
      debts: row,
    });
  }

  const converged = ![...balances.values()].some(b => b > 0);
  return {
    method, months: month, totalInterestPaid, totalPaid, payoffOrder,
    converged, series, perDebt: debts.map(d => perDebt.get(d.id)!),
  };
}
