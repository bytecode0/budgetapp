// Shares of the household's income chosen by the user (LPBETA-07 "Págate a ti
// primero", LPBETA-10 Generosity) and the onboarding's first goals. Pure, on
// integer cents and basis points (1000 bps = 10 %), shared by server and app.

/** Highest share a user can choose: 100 %. */
export const MAX_BPS = 10_000;

/** A percentage the user typed (e.g. 12.5) → basis points, or null when it
 *  isn't a number between 0 and 100. Two decimals at most survive. */
export function pctToBps(pct: unknown): number | null {
  const n = typeof pct === "string" ? Number(pct.replace(",", ".")) : pct;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** Basis points → a percentage number for display (1250 → 12.5). */
export function bpsToPct(bps: number): number {
  return bps / 100;
}

/** `bps` of `incomeCents`, rounded to the cent. 0 without income. */
export function shareOfIncome(incomeCents: number, bps: number): number {
  if (incomeCents <= 0 || bps <= 0) return 0;
  return Math.round((incomeCents * bps) / MAX_BPS);
}

/** Months of expenses the suggested emergency fund covers (LPBETA-07). */
export const EMERGENCY_FUND_MONTHS = 3;

/** Suggested emergency-fund target: three months of the budgeted expenses.
 *  The user can change it before creating the plan. */
export function emergencyFundTarget(monthlyExpensesCents: number): number {
  return Math.max(0, monthlyExpensesCents) * EMERGENCY_FUND_MONTHS;
}

// ── Home's traffic light ───────────────────────────────────────────────────
//
// What it measures (LPBETA-07): the month's two promises, in this order.
//  1. Spending against the budget — the question "¿vamos bien?". Categorised
//     spending only, the same figures as the rest of Home (uncategorised money
//     has no budget to compare against and gets its own nudge).
//  2. "Págate a ti primero" — what was set aside for yourself against the
//     share the user chose.
// Going over the budget is "over" (said as "te has pasado", in sun, never
// red: CLAUDE.md). Close to the budget (more than 80 % spent), or a past month
// that ended without paying yourself, is "tight". An open month where you
// haven't paid yourself yet stays "good" — the sentence reminds you — because
// the month isn't lost: you can still set it aside. Nothing to measure (no
// budget and no share chosen) is "neutral".

export type MonthLight = "good" | "tight" | "over" | "neutral";
export type MonthLightReason =
  | "noBudget"     // nothing budgeted and no share chosen
  | "overBudget"   // amountCents = how much over
  | "goalMissed"   // past month; amountCents = what was missing
  | "nearBudget"   // amountCents = what's left of the budget
  | "goalPending"  // open month; amountCents = what's left to set aside
  | "goalMet"      // spending fine and paid yourself
  | "onTrack";     // spending fine, no share chosen

export interface MonthLightInput {
  spentCents: number;     // categorised spending this month
  budgetedCents: number;  // total budgeted this month
  paidCents: number;      // set aside for yourself this month
  goalCents: number | null; // pay-yourself-first target; null = no share chosen
  closed: boolean;        // the month is over (a past month)
}

export interface MonthLightResult {
  light: MonthLight;
  reason: MonthLightReason;
  amountCents: number;
}

export function monthLight(input: MonthLightInput): MonthLightResult {
  const { spentCents, budgetedCents, paidCents, goalCents, closed } = input;
  const hasGoal = goalCents !== null && goalCents > 0;
  const missing = hasGoal ? Math.max(0, goalCents - paidCents) : 0;

  if (budgetedCents <= 0 && !hasGoal) return { light: "neutral", reason: "noBudget", amountCents: 0 };
  if (budgetedCents > 0 && spentCents > budgetedCents) {
    return { light: "over", reason: "overBudget", amountCents: spentCents - budgetedCents };
  }
  if (closed && missing > 0) return { light: "tight", reason: "goalMissed", amountCents: missing };
  // > 80 % of the budget spent, compared on integers (shared/budgetStatus.ts).
  if (budgetedCents > 0 && spentCents * 100 > budgetedCents * 80) {
    return { light: "tight", reason: "nearBudget", amountCents: budgetedCents - spentCents };
  }
  if (missing > 0) return { light: "good", reason: "goalPending", amountCents: missing };
  return { light: "good", reason: hasGoal ? "goalMet" : "onTrack", amountCents: 0 };
}
