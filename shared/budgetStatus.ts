// Home's colour thresholds, on integer cents (no float compare at a boundary).
// Pure: the app turns a tone into its emerald / amber / red classes.

export type Tone = "good" | "warning" | "over" | "neutral";

/** Euros as the API returns them → integer cents. */
export const toCents = (euros: number): number => Math.round(euros * 100);

/** part / whole ≤ pct %, compared on integers. */
const atMost = (part: number, whole: number, pct: number) => part * 100 <= whole * pct;

/** Share of the income already budgeted: ≤ 90 % good, ≤ 100 % warning, more
 *  than the income over. No income or no budget: nothing to judge. */
export function budgetedShareTone(incomeCents: number, budgetedCents: number): Tone {
  if (incomeCents <= 0 || budgetedCents <= 0) return "neutral";
  if (atMost(budgetedCents, incomeCents, 90)) return "good";
  if (atMost(budgetedCents, incomeCents, 100)) return "warning";
  return "over";
}

/** Spent of what was budgeted: ≤ 80 % good, ≤ 100 % warning, more over.
 *  The hero's "% used" and the spent-of-budgeted bar share it. */
export function spentShareTone(spentCents: number, budgetedCents: number): Tone {
  if (budgetedCents <= 0) return "neutral";
  if (atMost(spentCents, budgetedCents, 80)) return "good";
  if (atMost(spentCents, budgetedCents, 100)) return "warning";
  return "over";
}

/** part as a whole-number percentage of whole (display only); 0 without a whole. */
export function sharePct(partCents: number, wholeCents: number): number {
  return wholeCents > 0 ? Math.round((partCents * 100) / wholeCents) : 0;
}
