import type { StageId } from './stage/engine.js';
import { debtPressure, type FieldValueRow, type DebtRow } from './stage/inputs.js';
import {
  categoryLabel,
  archetypeLabel,
  archetypeDescription,
  radiografiaStageLabel,
  radiografiaStageDescription,
  opportunityText,
  type Lang,
} from '../xray/labels.js';

// ---- The persisted, analysis-derived part (Radiografia.resultado) ----
//
// Everything here comes from analyze() at /profile/extracto time and can
// NEVER be recomputed later, because raw transactions are never persisted
// (docs/plan-onboarding-radiografia.md §4.1 — only aggregates reach
// FinancialProfile). Framework percentages and debt pressure are
// deliberately NOT stored here: they're derived fresh from
// ProfileFieldValue/ProfileDebt every time a report is built (see
// buildRadiografiaEmailReport below), the same way the original 4-percentage
// report already worked — so correcting an income figure in the context
// step is reflected immediately, with no snapshot left stale.
//
// `health` is intentionally never itemized by category here — "categories"
// excludes it entirely (see writeRadiografiaSnapshot in
// server/routes/radiografia.ts). A health-category euro figure is a dataset
// about someone's health (pharmacy, clinic, dentist, insurer), which sits
// inside GDPR Article 9's special categories regardless of whether a
// merchant name is attached.
export interface RadiografiaCategorySnapshot {
  key: string;
  monthlyAvg: number; // euros
  annualized: number; // euros
  pct: number; // 0–1, share of the SHOWN categories (health excluded from the denominator too)
}
export interface RadiografiaHealthPillarSnapshot {
  key: string;
  score: number; // 0–100
  weight: number; // 0–1
}
export interface RadiografiaSnapshot {
  months: number;
  transactionCount: number;
  categories: RadiografiaCategorySnapshot[];
  // `names` are the merchant names behind each figure. They ARE persisted, on
  // the back of the explicit consent taken at the email step — without them
  // the permanent report and any resend could only say "gastas 600€ al año en
  // hormiga", never in WHAT, which is the part that makes the report worth
  // handing over a bank statement for. Only these two buckets: `health` never
  // reaches the snapshot at all, and giving stays in an anonymous
  // `giving_monthly` total (both GDPR Article 9). Optional because snapshots
  // written before this existed have no names.
  antExpenses: { monthlyAvg: number; annualized: number; names?: string[] } | null;
  recurring: { monthlyTotal: number; annualized: number; count: number; names?: string[] } | null;
  health: { score: number; pillars: RadiografiaHealthPillarSnapshot[] };
  archetype: { key: string; givingAssessed: boolean };
  balances: { hasData: boolean; runwayMonths: number | null };
  opportunities: { id: string; params: Record<string, number>; annualSaving: number }[];
}

// Merchant names as they travel from the browser: read from the statement,
// held in sessionStorage (see useOnboardingState.ts / EnrichmentBlock.tsx),
// and handed over at /email/verify — the point where the consent checkbox has
// been ticked. From there they're written INTO the snapshot above
// (withInsightNames in snapshot.ts), which is what lets the permanent web
// report and a resend name the same merchants the confirmation email named.
// Only ant expenses and subscription-like charges ever get here; health and
// giving are excluded upstream, in buildInsightNames.
export interface InsightNames {
  ant: { merchant: string; count: number }[];
  recurring: { merchant: string }[];
}

export interface RadiografiaAllocation {
  pct: number; // 0–100
  targetPct: number; // 0–100
  deviation: number; // pct − targetPct; positive = over target
}

export interface RadiografiaEmailReport {
  stageId: StageId | null;
  stageName: string | null;
  stageDescription: string | null;
  headline: string;
  allocations: {
    giving: RadiografiaAllocation;
    essentials: RadiografiaAllocation;
    savingsAndInvestment: RadiografiaAllocation;
    enjoyment: RadiografiaAllocation;
  };
  categories: { key: string; label: string; monthlyEur: number; annualEur: number; pct: number }[];
  antExpenses: { monthlyEur: number; annualEur: number; names: string[] } | null;
  recurring: { monthlyEur: number; annualEur: number; count: number; names: string[] } | null;
  debtPressure: { monthlyEur: number; pctOfIncome: number; alarming: boolean } | null;
  // `annualSaving` is shown as its own line in the report ("Impacto potencial:
  // +833 €/año"), so the reader can rank the three steps without parsing the
  // sentence. It's the same figure the sort below already uses.
  nextSteps: { title: string; detail: string; annualSaving: number }[];
  archetype: { key: string; label: string; description: string; givingAssessed: boolean } | null;
}

const INCOME_KEYS = new Set(['income_regular', 'income_floor']);

function sourceOrder(key: string): string[] {
  return INCOME_KEYS.has(key) ? ['manual', 'extracto', 'derivado'] : ['extracto', 'manual', 'derivado'];
}

function valueFor(values: FieldValueRow[], key: string): number {
  for (const source of sourceOrder(key)) {
    const hit = values.find(value => value.fieldKey === key && value.source === source);
    if (hit) return hit.valueCents;
  }
  return 0;
}

function asPercent(amount: number, income: number): number {
  return income > 0 ? Math.round((amount / income) * 100) : 0;
}

function money(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-GB', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

// The 10/50/20/20 framework (CLAUDE.md — the one place these thresholds are
// allowed to live). Never re-hardcode this elsewhere.
const FRAMEWORK_TARGET = { giving: 10, essentials: 50, savingsAndInvestment: 20, enjoyment: 20 };

function allocation(pct: number, targetPct: number): RadiografiaAllocation {
  return { pct, targetPct, deviation: pct - targetPct };
}

// One sentence that names the single biggest gap against the framework,
// personalized by stage — "here's the one thing that matters most today"
// rather than a wall of four numbers with no read on which one matters.
function pickHeadline(
  stageKey: string | null,
  income: number,
  allocations: RadiografiaEmailReport['allocations'],
  lang: Lang,
): string {
  const stageDesc = stageKey ? radiografiaStageDescription(stageKey, lang) : '';
  if (stageDesc) return stageDesc;
  if (income <= 0) {
    return lang === 'es'
      ? 'Todavía nos faltan tus números para decir algo concreto.'
      : "We still need your numbers to say something concrete.";
  }
  const gaps = [
    { area: lang === 'es' ? 'esenciales' : 'essentials', dev: allocations.essentials.deviation },
    { area: lang === 'es' ? 'disfrute' : 'enjoyment', dev: allocations.enjoyment.deviation },
    { area: lang === 'es' ? 'generosidad' : 'giving', dev: allocations.giving.deviation },
  ];
  const biggest = gaps.reduce((a, b) => (Math.abs(b.dev) > Math.abs(a.dev) ? b : a));
  if (Math.abs(biggest.dev) < 5) {
    return lang === 'es' ? 'Tu mes está repartido de forma equilibrada.' : 'Your month is well balanced.';
  }
  return lang === 'es'
    ? `${biggest.dev > 0 ? 'Estás por encima' : 'Estás por debajo'} del objetivo en ${biggest.area}.`
    : `You're ${biggest.dev > 0 ? 'above' : 'below'} target on ${biggest.area}.`;
}

// Shared by both the confirmation email and the permanent web report
// (GET /api/radiografia/report/:token) — one generator, one place the copy
// and the numbers can drift from each other.
export function buildRadiografiaEmailReport(params: {
  fieldValues: FieldValueRow[];
  debts: DebtRow[];
  incomeType: string;
  stageId: StageId | null;
  branchId?: string | null;
  snapshot: RadiografiaSnapshot | null;
  names?: InsightNames;
  lang?: Lang;
}): RadiografiaEmailReport {
  const lang: Lang = params.lang ?? 'es';
  const incomeKey = params.incomeType === 'irregular' ? 'income_floor' : 'income_regular';
  const income = valueFor(params.fieldValues, incomeKey);
  const essentials = valueFor(params.fieldValues, 'housing_payment') + valueFor(params.fieldValues, 'essentials_total');
  const savingsAndInvestment = valueFor(params.fieldValues, 'saving_monthly') + valueFor(params.fieldValues, 'investment_monthly');

  const allocations = {
    giving: allocation(asPercent(valueFor(params.fieldValues, 'giving_monthly'), income), FRAMEWORK_TARGET.giving),
    essentials: allocation(asPercent(essentials, income), FRAMEWORK_TARGET.essentials),
    savingsAndInvestment: allocation(asPercent(savingsAndInvestment, income), FRAMEWORK_TARGET.savingsAndInvestment),
    enjoyment: allocation(asPercent(valueFor(params.fieldValues, 'enjoyment_total'), income), FRAMEWORK_TARGET.enjoyment),
  };

  const debt = debtPressure({ fieldValues: params.fieldValues, debts: params.debts, incomeType: params.incomeType === 'irregular' ? 'irregular' : 'regular' });
  const debtPressureOut = debt.monthlyTotal > 0
    ? { monthlyEur: debt.monthlyTotal / 100, pctOfIncome: Math.round(debt.pctOfIncome * 100), alarming: debt.pctOfIncome >= 0.20 }
    : null;

  // Filtered here too, not just where the snapshot is written
  // (server/routes/radiografia.ts's writeRadiografiaSnapshot) — this is the
  // boundary that actually matters for the compliance guarantee: any future
  // code path that touches Radiografia.resultado without going through the
  // writer (a migration, an admin tool) must still never surface it.
  const categories = (params.snapshot?.categories ?? [])
    .filter(c => c.key !== 'health')
    .slice(0, 6)
    .map(c => ({ key: c.key, label: categoryLabel(c.key, lang), monthlyEur: c.monthlyAvg, annualEur: c.annualized, pct: Math.round(c.pct * 100) }));

  // `params.names` (this request's sessionStorage hand-over) wins over the
  // persisted copy only because it's the fresher of two identical things —
  // /email/verify writes them into the snapshot immediately before building
  // this report. The fallback is what the permanent report and every resend
  // read, and an older snapshot with no names simply shows none.
  const antExpenses = params.snapshot?.antExpenses
    ? {
        monthlyEur: params.snapshot.antExpenses.monthlyAvg,
        annualEur: params.snapshot.antExpenses.annualized,
        names: params.names?.ant.map(n => n.merchant) ?? params.snapshot.antExpenses.names ?? [],
      }
    : null;

  const recurring = params.snapshot?.recurring
    ? {
        monthlyEur: params.snapshot.recurring.monthlyTotal,
        annualEur: params.snapshot.recurring.annualized,
        count: params.snapshot.recurring.count,
        names: params.names?.recurring.map(n => n.merchant) ?? params.snapshot.recurring.names ?? [],
      }
    : null;

  // analyze.ts's own "review_subscriptions" opportunity counts and sums ALL
  // stable recurring charges — rent and a credit-card payment included, since
  // analyze() has no notion of "subscription" beyond "charges the same amount
  // every month". Re-deriving its count/saving from the ALREADY-FILTERED
  // `recurring` above keeps this copy consistent with the card the reader
  // just saw two paragraphs up ("6 suscripciones"), instead of surfacing a
  // second, larger, unexplained number ("revisa tus 8 suscripciones") for
  // what a reader would reasonably assume is the same thing. If nothing
  // survives the filtering, the opportunity is dropped rather than shown with
  // a stale or zeroed-out count.
  const opportunities = (params.snapshot?.opportunities ?? [])
    .map(o => {
      if (o.id !== 'review_subscriptions') return o;
      if (!recurring) return null;
      return { ...o, params: { count: recurring.count }, annualSaving: Math.round(recurring.annualEur * 0.25) };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  const nextSteps = opportunities
    .slice()
    .sort((a, b) => b.annualSaving - a.annualSaving)
    .slice(0, 3)
    .map(o => ({ ...opportunityText(o.id, o.params, o.annualSaving, lang, n => money(n, lang)), annualSaving: o.annualSaving }));

  const archetype = params.snapshot?.archetype
    ? {
        key: params.snapshot.archetype.key,
        label: archetypeLabel(params.snapshot.archetype.key, lang),
        description: archetypeDescription(params.snapshot.archetype.key, lang),
        givingAssessed: params.snapshot.archetype.givingAssessed,
      }
    : null;

  const stageKey = params.branchId ?? params.stageId;
  const headline = pickHeadline(stageKey, income, allocations, lang);

  return {
    stageId: params.stageId,
    stageName: stageKey ? radiografiaStageLabel(stageKey, lang) : null,
    stageDescription: stageKey ? radiografiaStageDescription(stageKey, lang) : null,
    headline,
    allocations,
    categories,
    antExpenses,
    recurring,
    debtPressure: debtPressureOut,
    nextSteps,
    archetype,
  };
}
