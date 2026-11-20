// Home's colour thresholds, on integer cents (no float compare at a boundary).
// Pure: the app turns a tone into its emerald / amber / red classes.

export type Tone = "good" | "warning" | "over" | "neutral";

/** Euros as the API returns them → integer cents. */
export const toCents = (euros: number): number => Math.round(euros * 100);

/** part / whole ≤ pct %, compared on integers. */
const atMost = (part: number, whole: number, pct: number) => part * 100 <= whole * pct;

/** How the month's total budgeted compares with its income (LPBETA-30). */
export type IncomeCoverage = "noIncome" | "under" | "near" | "exact" | "over";

/** Total budgeted against income: under 85 % "under", 85 % to just under
 *  100 % "near", equal to the cent "exact", more "over"; no income is
 *  "noIncome" (nothing to compare with). Compared by integer
 *  cross-multiplication. `pct` is the label next to the colour: rounded DOWN
 *  up to 100 % and UP above it, so it never contradicts the level (84.99 %
 *  shows "84 %" under, 99.99 % "99 %" near, 100.01 % "101 %" over). */
export function budgetedVsIncome(incomeCents: number, budgetedCents: number): { level: IncomeCoverage; pct: number } {
  if (incomeCents <= 0) return { level: "noIncome", pct: 0 };
  const budgeted = Math.max(0, budgetedCents);
  const level: IncomeCoverage =
    budgeted * 100 < incomeCents * 85 ? "under"
    : budgeted < incomeCents ? "near"
    : budgeted === incomeCents ? "exact"
    : "over";
  const share = (budgeted * 100) / incomeCents;
  return { level, pct: level === "over" ? Math.ceil(share) : Math.floor(share) };
}

/** Spent of what was budgeted: ≤ 80 % good, ≤ 100 % warning, more over.
 *  The hero's "% used" and the spent-of-budgeted bar share it. */
export function spentShareTone(spentCents: number, budgetedCents: number): Tone {
  if (budgetedCents <= 0) return "neutral";
  if (atMost(spentCents, budgetedCents, 80)) return "good";
  if (atMost(spentCents, budgetedCents, 100)) return "warning";
  return "over";
}

/** part as a whole-number percentage of whole, for a label next to a tone;
 *  0 without a whole. Rounded UP: the thresholds are whole percentages and a
 *  tone changes only once the share goes past one, and ceil(x) > T exactly
 *  when x > T, so the label never contradicts the colour (80.3 % shows "81 %"
 *  amber, never "80 %" amber; exactly 80 % shows "80 %" green). */
export function sharePct(partCents: number, wholeCents: number): number {
  return wholeCents > 0 ? Math.ceil((partCents * 100) / wholeCents) : 0;
}
