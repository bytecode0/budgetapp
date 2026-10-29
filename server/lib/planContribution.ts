// What an expense adds to the life plan behind its "plan" budget line
// (LifePlan.currentAmount, cents). Pure.
//
// An expense on a plan line is money put into the plan; a refund on it is
// money taken back out, so it contributes −amount (Expense.kind "refund"
// keeps a positive amount — see debtBalance.ts).
export function planContribution(e: { kind?: string | null; amount: number }): number {
  return e.kind === "refund" ? -e.amount : e.amount;
}

/** Net change per life plan for a batch of new expenses, given which
 *  allocations are plan lines (allocationId → lifePlanId). Zero nets dropped. */
export function planContributions(
  rows: { kind?: string | null; amount: number; allocationId: string | null }[],
  planByLine: ReadonlyMap<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const plan = r.allocationId ? planByLine.get(r.allocationId) : undefined;
    if (plan) out.set(plan, (out.get(plan) ?? 0) + planContribution(r));
  }
  for (const [plan, delta] of out) if (delta === 0) out.delete(plan);
  return out;
}
