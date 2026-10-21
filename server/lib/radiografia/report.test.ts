import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadiografiaEmailReport, type RadiografiaSnapshot } from './report.js';

const NO_DEBTS: never[] = [];

function fullSnapshot(): RadiografiaSnapshot {
  return {
    months: 3,
    transactionCount: 120,
    categories: [
      { key: 'restaurants', monthlyAvg: 120, annualized: 1440, pct: 0.4 },
      { key: 'delivery', monthlyAvg: 60, annualized: 720, pct: 0.2 },
      { key: 'supermarket', monthlyAvg: 180, annualized: 2160, pct: 0.4 },
    ],
    antExpenses: { monthlyAvg: 45, annualized: 540 },
    recurring: { monthlyTotal: 35, annualized: 420, count: 4 },
    health: { score: 72, pillars: [{ key: 'savings', score: 80, weight: 0.25 }] },
    archetype: { key: 'builder', givingAssessed: true },
    balances: { hasData: true, runwayMonths: 3.2 },
    opportunities: [
      { id: 'review_subscriptions', params: { count: 4 }, annualSaving: 105 },
      { id: 'halve_ant', params: {}, annualSaving: 270 },
    ],
  };
}

test('email report contains only percentages and respects source precedence', () => {
  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: 'fortaleza',
    debts: NO_DEBTS,
    snapshot: null,
    fieldValues: [
      { fieldKey: 'income_regular', valueCents: 200_000, source: 'extracto' },
      { fieldKey: 'income_regular', valueCents: 300_000, source: 'manual' },
      { fieldKey: 'housing_payment', valueCents: 100_000, source: 'manual' },
      { fieldKey: 'essentials_total', valueCents: 50_000, source: 'manual' },
      { fieldKey: 'saving_monthly', valueCents: 30_000, source: 'manual' },
      { fieldKey: 'investment_monthly', valueCents: 30_000, source: 'manual' },
      { fieldKey: 'giving_monthly', valueCents: 30_000, source: 'manual' },
      { fieldKey: 'enjoyment_total', valueCents: 60_000, source: 'manual' },
    ],
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(report.allocations).map(([k, v]) => [k, v.pct])),
    { giving: 10, essentials: 50, savingsAndInvestment: 20, enjoyment: 20 },
  );
  assert.equal(report.stageName, 'Fortaleza');
});

test('email report uses the irregular-income floor and never divides by zero', () => {
  const report = buildRadiografiaEmailReport({
    incomeType: 'irregular',
    stageId: null,
    debts: NO_DEBTS,
    snapshot: null,
    fieldValues: [
      { fieldKey: 'income_floor', valueCents: 0, source: 'manual' },
      { fieldKey: 'housing_payment', valueCents: 50_000, source: 'manual' },
    ],
  });

  assert.deepEqual(
    Object.fromEntries(Object.entries(report.allocations).map(([k, v]) => [k, v.pct])),
    { giving: 0, essentials: 0, savingsAndInvestment: 0, enjoyment: 0 },
  );
  assert.equal(report.headline.length > 0, true);
});

test('a manual-only profile (no statement yet) has no categories, ant expenses, recurring, or archetype', () => {
  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: null,
    debts: NO_DEBTS,
    snapshot: null,
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 250_000, source: 'manual' }],
  });

  assert.equal(report.categories.length, 0);
  assert.equal(report.antExpenses, null);
  assert.equal(report.recurring, null);
  assert.equal(report.archetype, null);
});

test('a full extracto-backed profile surfaces categories, ant expenses, recurring, and archetype', () => {
  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: 'liberacion',
    debts: NO_DEBTS,
    snapshot: fullSnapshot(),
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 250_000, source: 'extracto' }],
  });

  assert.equal(report.categories.length, 3);
  assert.equal(report.categories[0].label, 'Restaurantes');
  assert.ok(report.antExpenses);
  assert.equal(report.antExpenses!.monthlyEur, 45);
  assert.equal(report.antExpenses!.names.length, 0); // no names passed in => none shown
  assert.ok(report.recurring);
  assert.equal(report.recurring!.count, 4);
  assert.ok(report.archetype);
  assert.equal(report.archetype!.key, 'builder');
  assert.equal(report.nextSteps.length, 2);
  assert.equal(report.nextSteps[0].title, 'Domar tus gastos hormiga'); // higher annualSaving (270) sorts first
});

test('merchant names are passed through only when explicitly provided, and never persisted or inferred', () => {
  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: null,
    debts: NO_DEBTS,
    snapshot: fullSnapshot(),
    names: { ant: [{ merchant: 'Glovo', count: 11 }], recurring: [{ merchant: 'Netflix' }] },
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 250_000, source: 'extracto' }],
  });

  assert.deepEqual(report.antExpenses!.names, ['Glovo']);
  assert.deepEqual(report.recurring!.names, ['Netflix']);
});

test('health is never itemized in the categories breakdown, even if present in the snapshot', () => {
  const snapshot = fullSnapshot();
  snapshot.categories.push({ key: 'health', monthlyAvg: 999_999, annualized: 999_999, pct: 0.99 });

  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: null,
    debts: NO_DEBTS,
    snapshot,
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 250_000, source: 'extracto' }],
  });

  assert.equal(report.categories.some((c) => c.key === 'health'), false);
});

test('the "review your subscriptions" step uses the already-filtered subscriptions count, not analyze()\'s raw unfiltered one', () => {
  // analyze() itself counted 8 recurring merchants (rent and a card payment
  // included) when it built this opportunity — but the snapshot\'s own
  // `recurring` block, built by the (housing/health/debt-excluding) snapshot
  // builder, says 6. The report must show 6, matching the "Tus suscripciones"
  // figure the reader just saw, not analyze()\'s inflated raw count.
  const snapshot = fullSnapshot();
  snapshot.recurring = { monthlyTotal: 38, annualized: 456, count: 6 };
  snapshot.opportunities = [{ id: 'review_subscriptions', params: { count: 8 }, annualSaving: 999 }];

  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: null,
    debts: NO_DEBTS,
    snapshot,
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 250_000, source: 'extracto' }],
  });

  assert.equal(report.nextSteps.length, 1);
  assert.equal(report.nextSteps[0].title, 'Revisa tus 6 suscripciones');
  assert.equal(report.nextSteps[0].detail.includes(String(Math.round(456 * 0.25))), true);
});

test('the "review your subscriptions" step disappears if nothing survives the subscriptions filter, rather than showing a stale count', () => {
  const snapshot = fullSnapshot();
  snapshot.recurring = null;
  snapshot.opportunities = [{ id: 'review_subscriptions', params: { count: 8 }, annualSaving: 999 }];

  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: null,
    debts: NO_DEBTS,
    snapshot,
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 250_000, source: 'extracto' }],
  });

  assert.equal(report.nextSteps.length, 0);
});

test('debt pressure is computed from current ProfileDebt rows, not the snapshot, and flags >=20% as alarming', () => {
  const report = buildRadiografiaEmailReport({
    incomeType: 'regular',
    stageId: null,
    snapshot: null,
    debts: [{ kind: 'credit_card', monthlyPayment: 60_000, source: 'manual' }],
    fieldValues: [{ fieldKey: 'income_regular', valueCents: 200_000, source: 'manual' }],
  });

  assert.ok(report.debtPressure);
  assert.equal(report.debtPressure!.pctOfIncome, 30);
  assert.equal(report.debtPressure!.alarming, true);
});
