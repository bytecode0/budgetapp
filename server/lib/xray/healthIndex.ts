// Financial Health Index for the Radiografía Financiera flow.
//
// A 0–100 composite over 5 pillars. Design goals (product): never judgmental —
// no pass/fail, staged labels, and we always surface the user's strongest pillar
// first. Each pillar scores 0–100 independently; the index is their weighted sum.
//
// All monetary inputs are EUROS (the analyzer already converted from cents).

export interface HealthPillar {
  key: "savings" | "structure" | "leaks" | "commitments" | "stability";
  label: string;              // i18n key suffix, resolved client-side
  score: number;              // 0–100
  weight: number;             // 0–1 (effective, after redistribution)
  caption: string;            // i18n key suffix for a one-line explanation
}

export interface HealthIndex {
  score: number;              // 0–100 (weighted, rounded)
  stage: "building" | "balancing" | "growing" | "solid";
  pillars: HealthPillar[];
  strongestKey: HealthPillar["key"];
}

export interface HealthInput {
  monthlyIncome: number;      // euros/month (avg)
  monthlyExpenses: number;    // euros/month (avg)
  monthlyRecurring: number;   // euros/month of detected recurring commitments
  monthlyAnt: number;         // euros/month of "gastos hormiga"
  recurringCount: number;     // number of distinct recurring merchants
  monthlyNet: number[];       // net (income − expense) per calendar month, chronological
  months: number;             // distinct months covered by the statement
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/** Linear score: `good` value → 100, `bad` value → 0, clamped. Handles either direction. */
function lerpScore(value: number, good: number, bad: number): number {
  if (good === bad) return 50;
  const t = (value - bad) / (good - bad);
  return clamp(t * 100);
}

function savingsScore(income: number, expenses: number): number {
  if (income <= 0) return 0;
  const rate = (income - expenses) / income;   // can be negative
  // 20%+ savings → 100; 0% → ~30; negative (spending more than earning) → 0.
  if (rate <= 0) return clamp(30 + rate * 300); // −10% → 0
  return clamp(30 + (rate / 0.2) * 70);
}

function structureScore(income: number, recurring: number): number {
  if (income <= 0) return 50;
  const ratio = recurring / income;            // share of income already committed
  return lerpScore(ratio, 0.35, 0.85);         // ≤35% ideal → 100; ≥85% → 0
}

function leaksScore(antMonthly: number, expenses: number): number {
  if (expenses <= 0) return 100;
  const ratio = antMonthly / expenses;
  return lerpScore(ratio, 0.03, 0.20);         // ≤3% → 100; ≥20% → 0
}

function commitmentsScore(count: number): number {
  // Subscriptions are not inherently bad, so this never bottoms out at 0.
  // ≤3 → 100; 12+ → 40 (a nudge to review, not a failure).
  return clamp(lerpScore(count, 3, 12) * 0.6 + 40, 40, 100);
}

function stabilityScore(monthlyNet: number[]): number | null {
  if (monthlyNet.length < 2) return null;       // not enough data to judge
  const mean = monthlyNet.reduce((s, n) => s + n, 0) / monthlyNet.length;
  if (Math.abs(mean) < 1) return 60;            // basically break-even, neutral
  const variance = monthlyNet.reduce((s, n) => s + (n - mean) ** 2, 0) / monthlyNet.length;
  const cv = Math.sqrt(variance) / Math.abs(mean); // coefficient of variation
  return lerpScore(cv, 0.15, 1.0);              // steady → 100; wildly swinging → 0
}

function stageFor(score: number): HealthIndex["stage"] {
  if (score < 40) return "building";
  if (score < 60) return "balancing";
  if (score < 80) return "growing";
  return "solid";
}

export function computeHealthIndex(input: HealthInput): HealthIndex {
  const raw = [
    { key: "savings" as const, label: "savings", weight: 0.30, caption: "savings",
      score: savingsScore(input.monthlyIncome, input.monthlyExpenses) },
    { key: "structure" as const, label: "structure", weight: 0.25, caption: "structure",
      score: structureScore(input.monthlyIncome, input.monthlyRecurring) },
    { key: "leaks" as const, label: "leaks", weight: 0.15, caption: "leaks",
      score: leaksScore(input.monthlyAnt, input.monthlyExpenses) },
    { key: "commitments" as const, label: "commitments", weight: 0.15, caption: "commitments",
      score: commitmentsScore(input.recurringCount) },
    { key: "stability" as const, label: "stability", weight: 0.15, caption: "stability",
      score: stabilityScore(input.monthlyNet) },
  ];

  // Stability may be unavailable (single-month statement). Drop it and
  // redistribute its weight proportionally across the remaining pillars.
  const available = raw.filter(p => p.score !== null) as (Omit<HealthPillar, "score"> & { score: number })[];
  const totalWeight = available.reduce((s, p) => s + p.weight, 0);
  const pillars: HealthPillar[] = available.map(p => ({
    key: p.key,
    label: p.label,
    caption: p.caption,
    weight: p.weight / totalWeight,
    score: Math.round(p.score),
  }));

  const score = Math.round(pillars.reduce((s, p) => s + p.score * p.weight, 0));
  const strongest = pillars.reduce((a, b) => (b.score > a.score ? b : a), pillars[0]);

  return { score, stage: stageFor(score), pillars, strongestKey: strongest.key };
}
