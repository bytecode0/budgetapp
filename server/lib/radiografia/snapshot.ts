// Pure transform from analyze()'s output to the persisted, analysis-derived
// part of the report (Radiografia.resultado). Deliberately has NO import of
// mailer.ts or prisma — mailer.ts constructs a live Resend client at module
// load time, which throws when RESEND_API_KEY is unset, so anything that
// needs to unit-test this logic in isolation (server/lib/radiografia/snapshot.test.ts)
// must not pull that module in transitively. server/routes/radiografia.ts
// does the actual DB write; this only builds the object.
import type { XRayResult } from "../xray/analyze.js";
import type { RadiografiaSnapshot, InsightNames } from "./report.js";

// `result.recurring.items` is analyze.ts's general "this merchant charges a
// stable amount every month" detector — it has no idea whether that merchant
// is a subscription, the rent, or a credit-card payment. Housing and detected
// debts are ALREADY their own sections (categories' "housing" entry,
// debtPressure) — showing them again under "suscripciones" would be a
// straight double-count. "health" is excluded for the same reason as the
// category breakdown below: a recurring pharmacy/insurer charge is still
// health data (GDPR Article 9) whether it's shown by name or folded into an
// aggregate total, so it's excluded here rather than trusting the top-level
// monthlyTotal/annualized analyze.ts computed across everything.
export function subscriptionLikeRecurring(result: XRayResult) {
  const debtMerchants = new Set(result.debts.items.map((d) => d.merchant));
  return result.recurring.items.filter(
    (i) => i.categoryKey !== "housing" && i.categoryKey !== "health" && !debtMerchants.has(i.merchant),
  );
}

// The merchant names behind the two buckets the report is allowed to name.
// Handed to the browser, kept in sessionStorage, and written back into the
// snapshot at /email/verify once consent exists (see withInsightNames below).
// `antExpenses.items` is already
// clean of health-category merchants (analyze.ts's own antExcludeKeys
// excludes "health" before this function ever sees the data) and
// structurally can't contain a giving movement (ant expenses are drawn from
// `consumption`; giving lives in the disjoint `wealth` partition) — so no
// filtering is needed there.
export const MAX_INSIGHT_NAMES = 5;
export function buildInsightNames(result: XRayResult): InsightNames {
  return {
    ant: result.antExpenses.items.slice(0, MAX_INSIGHT_NAMES).map((i) => ({ merchant: i.merchant, count: i.count })),
    recurring: subscriptionLikeRecurring(result)
      .slice(0, MAX_INSIGHT_NAMES)
      .map((i) => ({ merchant: i.merchant })),
  };
}

// Folds the merchant names into an already-persisted snapshot. Separate from
// buildRadiografiaSnapshot because the two happen at different moments and for
// different reasons: the snapshot is written at /profile/extracto time, before
// anyone has agreed to anything, while the names may only be stored once the
// consent checkbox at the email step has been ticked. Pure and total — a
// snapshot whose antExpenses/recurring came back null (nothing detected) has
// nowhere to put names, and keeps none.
export function withInsightNames(snapshot: RadiografiaSnapshot, names: InsightNames): RadiografiaSnapshot {
  return {
    ...snapshot,
    antExpenses: snapshot.antExpenses
      ? { ...snapshot.antExpenses, names: names.ant.map((n) => n.merchant) }
      : null,
    recurring: snapshot.recurring
      ? { ...snapshot.recurring, names: names.recurring.map((n) => n.merchant) }
      : null,
  };
}

// The analysis-derived part of the report. `health` is excluded from the
// category breakdown entirely — a health-category euro figure is data about
// someone's health regardless of whether a merchant name is attached (GDPR
// Article 9). See RadiografiaSnapshot's own comment in report.ts for the
// fuller reasoning, and report.ts's buildRadiografiaEmailReport for why this
// same exclusion is enforced AGAIN at read time, not just here.
export function buildRadiografiaSnapshot(result: XRayResult): RadiografiaSnapshot {
  const shown = result.categories.filter((c) => c.key !== "health");
  const shownTotalCents = shown.reduce((sum, c) => sum + Math.round(c.monthlyAvg * 100), 0);
  const categories = shown.map((c) => ({
    key: c.key,
    monthlyAvg: c.monthlyAvg,
    annualized: c.annualized,
    pct: shownTotalCents > 0 ? Math.round(c.monthlyAvg * 100) / shownTotalCents : 0,
  }));

  const subscriptions = subscriptionLikeRecurring(result);
  const subscriptionsMonthly = subscriptions.reduce((sum, i) => sum + i.monthlyAmount, 0);
  const subscriptionsAnnualized = subscriptions.reduce((sum, i) => sum + i.annualized, 0);

  return {
    months: result.period.months,
    transactionCount: result.summary.transactionCount,
    categories,
    antExpenses: result.antExpenses.monthlyAvg > 0
      ? { monthlyAvg: result.antExpenses.monthlyAvg, annualized: result.antExpenses.annualized }
      : null,
    recurring: subscriptions.length > 0
      ? { monthlyTotal: subscriptionsMonthly, annualized: subscriptionsAnnualized, count: subscriptions.length }
      : null,
    health: {
      score: result.health.score,
      pillars: result.health.pillars.map((p) => ({ key: p.key, score: p.score, weight: p.weight })),
    },
    archetype: { key: result.archetype.key, givingAssessed: result.archetype.givingAssessed },
    balances: { hasData: result.balances.hasData, runwayMonths: result.balances.runwayMonths },
    opportunities: result.opportunities.map((o) => ({ id: o.id, params: o.params, annualSaving: o.annualSaving })),
  };
}
