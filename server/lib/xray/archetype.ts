// Financial archetype for the Radiografía.
//
// The health score answers "how well am I doing". The archetype answers a
// different question — "what kind of steward am I" — and the two do NOT sit on
// one axis. Someone can give faithfully and have no cushion; someone can save
// 40% and give nothing. A linear score→archetype mapping produced nonsense like
// awarding "El Mayordomo Fiel" for a high score to a person who wasn't giving
// consistently at all.
//
// So it's two axes:
//   1. Is giving faithful?  (consistent, meaningful, stable)
//   2. What happens to the surplus?  (nothing / saved / invested)
//
//                  │ no margin        │ saves            │ invests
//   ───────────────┼──────────────────┼──────────────────┼──────────────────
//   faithful giver │ braveGiver       │ steward          │ multiplier
//   not (yet)      │ slave / juggler  │ builder          │ sower

export type Archetype =
  | "slave"        // debt eats the month before it starts
  | "juggler"      // no debt burden, but no cushion either
  | "builder"      // saves steadily, doesn't invest
  | "sower"        // puts savings to work
  | "braveGiver"   // gives faithfully before securing himself
  | "steward"      // gives faithfully AND has margin
  | "multiplier";  // gives faithfully AND invests

export interface ArchetypeInput {
  monthsCovered: number;
  incomeCents: number;
  /** Distinct months in which any giving happened. */
  givingMonths: number;
  /** Every individual giving amount (cents), for the stability check. */
  givingAmounts: number[];
  savingsCents: number;
  investmentCents: number;
  debtPctOfIncome: number;   // 0–1
}

export interface ArchetypeResult {
  key: Archetype;
  /** True when the giving axis was actually assessable (enough history). */
  givingAssessed: boolean;
  faithfulGiver: boolean;
  givingPctOfIncome: number; // 0–1
}

// A statement shorter than this can't tell a habit from a coincidence, so the
// giving axis is left unassessed rather than guessed at.
const MIN_MONTHS_FOR_GIVING = 3;
// "At least 10 times a year" expressed as a rate, so it works on any window.
const MIN_GIVING_MONTH_RATE = 10 / 12;
const MIN_GIVING_PCT = 0.05;
// Amounts must be *stable*, not identical: real tithing tracks income, so €150
// one month and €200 the next is still faithful. Coefficient of variation.
const MAX_GIVING_VARIATION = 0.25;
// Below this, a "surplus" is rounding noise rather than a habit.
const MIN_MARGIN_PCT = 0.02;
// Above this share of income committed to debt, the month is not really yours.
const DEBT_BURDEN_PCT = 0.20;

/** Coefficient of variation (stdev / mean). 0 for fewer than 2 samples. */
function variation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function computeArchetype(input: ArchetypeInput): ArchetypeResult {
  const { monthsCovered, incomeCents, givingMonths, givingAmounts } = input;
  const givingTotal = givingAmounts.reduce((s, v) => s + v, 0);
  // Percentage is measured PER GIVING MONTH, not across the whole window:
  // €100/month on a €2000 income is 5%, even if one month was missed. Dividing
  // the yearly total by the yearly income would read 4.58% and disqualify a
  // person who is plainly tithing — the missed month is already accounted for by
  // the consistency rule below, and must not be penalised twice.
  const monthlyIncome = monthsCovered > 0 ? incomeCents / monthsCovered : 0;
  const avgGiving = givingMonths > 0 ? givingTotal / givingMonths : 0;
  const givingPctOfIncome = monthlyIncome > 0 ? avgGiving / monthlyIncome : 0;

  const givingAssessed = monthsCovered >= MIN_MONTHS_FOR_GIVING;
  const faithfulGiver =
    givingAssessed &&
    monthsCovered > 0 &&
    givingMonths / monthsCovered >= MIN_GIVING_MONTH_RATE &&
    givingPctOfIncome >= MIN_GIVING_PCT &&
    variation(givingAmounts) <= MAX_GIVING_VARIATION;

  const investPct = incomeCents > 0 ? input.investmentCents / incomeCents : 0;
  const savePct = incomeCents > 0 ? input.savingsCents / incomeCents : 0;
  const invests = investPct >= MIN_MARGIN_PCT;
  const saves = savePct >= MIN_MARGIN_PCT;

  let key: Archetype;
  if (faithfulGiver) {
    key = invests ? "multiplier" : saves ? "steward" : "braveGiver";
  } else if (invests) {
    key = "sower";
  } else if (saves) {
    key = "builder";
  } else {
    key = input.debtPctOfIncome >= DEBT_BURDEN_PCT ? "slave" : "juggler";
  }

  return { key, givingAssessed, faithfulGiver, givingPctOfIncome };
}

export type ArchetypeLight = "red" | "amber" | "green";

/** Traffic light for the shareable card — readable before any text is. */
export function archetypeLight(key: Archetype): ArchetypeLight {
  if (key === "slave") return "red";
  // A faithful giver with no cushion is genuinely fragile, however admirable.
  if (key === "juggler" || key === "braveGiver") return "amber";
  return "green";
}
