import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadiografiaSnapshot, buildInsightNames, withInsightNames } from './snapshot.js';
import type { XRayResult } from '../xray/analyze.js';

// Minimal XRayResult fixture — only the fields buildRadiografiaSnapshot and
// buildInsightNames actually read. `as unknown as XRayResult` keeps this test
// from having to construct every field of the real (large) interface.
function fixture(overrides: Partial<XRayResult> = {}): XRayResult {
  const base = {
    period: { from: '2026-01-01', to: '2026-03-31', months: 3 },
    summary: { totalIncome: 7500, totalExpenses: 3000, net: 4500, savingsRate: 0.6, transactionCount: 60 },
    categories: [
      { key: 'restaurants', icon: '🍽️', label: null, total: 300, monthlyAvg: 100, annualized: 1200, pct: 0.5, txnCount: 10 },
      { key: 'health', icon: '💊', label: null, total: 300, monthlyAvg: 100, annualized: 1200, pct: 0.5, txnCount: 6 },
    ],
    antExpenses: { monthlyAvg: 40, annualized: 480, items: [{ merchant: 'glovo', count: 10, total: 120, avgTicket: 12 }] },
    recurring: {
      monthlyTotal: 300,
      annualized: 3600,
      count: 4,
      items: [
        { merchant: 'netflix', monthlyAmount: 13, annualized: 156, categoryKey: 'subscriptions' },
        { merchant: 'alquiler', monthlyAmount: 850, annualized: 10200, categoryKey: 'housing' },
        { merchant: 'farmacia', monthlyAmount: 40, annualized: 480, categoryKey: 'health' },
        { merchant: 'visa', monthlyAmount: 120, annualized: 1440, categoryKey: 'other' },
      ],
    },
    wealth: { total: 0, savings: 0, giving: 0, investment: 0, items: [] },
    uncertain: { total: 0, items: [] },
    income: { excluded: { total: 0, items: [] }, uncertain: { total: 0, items: [] } },
    internalTransfers: { count: 0, total: 0, items: [] },
    balances: { hasData: true, total: 2000, accounts: [], runwayMonths: 4 },
    debts: {
      monthlyTotal: 120,
      pctOfIncome: 0.048,
      items: [{ merchant: 'visa', kind: 'credit_card', monthlyAmount: 120 }],
      mortgage: null,
    },
    topMerchants: [],
    health: {
      score: 80,
      stage: 'growing',
      pillars: [{ key: 'savings', label: 'savings', score: 90, weight: 0.25, caption: 'savings' }],
      strongestKey: 'savings',
    },
    archetype: { key: 'builder', givingAssessed: true, faithfulGiver: false, givingPctOfIncome: 0 },
    opportunities: [{ id: 'halve_ant', annualSaving: 240, params: {} }],
  };
  return { ...base, ...overrides } as unknown as XRayResult;
}

test('health is never itemized in the persisted category breakdown', () => {
  const snapshot = buildRadiografiaSnapshot(fixture());
  assert.equal(snapshot.categories.some((c) => c.key === 'health'), false);
  assert.equal(snapshot.categories.length, 1);
  assert.equal(snapshot.categories[0].pct, 1); // recomputed against the shown-only total
});

test('the subscriptions aggregate excludes housing, health, and detected debts — only the actual subscription remains', () => {
  const snapshot = buildRadiografiaSnapshot(fixture());
  assert.ok(snapshot.recurring);
  assert.equal(snapshot.recurring!.count, 1);
  assert.equal(snapshot.recurring!.monthlyTotal, 13);
});

test('recurring is null when nothing survives the exclusion, not an empty-but-present block', () => {
  const snapshot = buildRadiografiaSnapshot(fixture({
    recurring: {
      monthlyTotal: 40,
      annualized: 480,
      count: 1,
      items: [{ merchant: 'farmacia', monthlyAmount: 40, annualized: 480, categoryKey: 'health' }],
    },
  }));
  assert.equal(snapshot.recurring, null);
});

test('antExpenses is null when analyze() found none', () => {
  const snapshot = buildRadiografiaSnapshot(fixture({ antExpenses: { monthlyAvg: 0, annualized: 0, items: [] } }));
  assert.equal(snapshot.antExpenses, null);
});

test('insight names never include a health-category or housing/debt merchant, and cap at 5', () => {
  const names = buildInsightNames(fixture());
  assert.deepEqual(names.recurring, [{ merchant: 'netflix' }]);
  assert.deepEqual(names.ant, [{ merchant: 'glovo', count: 10 }]);
});

test('archetype and health pillars pass through, unfiltered by category (they are not per-category data)', () => {
  const snapshot = buildRadiografiaSnapshot(fixture());
  assert.equal(snapshot.archetype.key, 'builder');
  assert.equal(snapshot.health.pillars.length, 1);
});

test('withInsightNames attaches the merchant names and changes nothing else', () => {
  const snapshot = buildRadiografiaSnapshot(fixture());
  const annotated = withInsightNames(snapshot, buildInsightNames(fixture()));

  assert.deepEqual(annotated.antExpenses!.names, ['glovo']);
  assert.deepEqual(annotated.recurring!.names, ['netflix']);
  // Same figures, same exclusions — this only ever adds names.
  assert.equal(annotated.antExpenses!.annualized, snapshot.antExpenses!.annualized);
  assert.equal(annotated.recurring!.count, snapshot.recurring!.count);
  assert.deepEqual(annotated.categories, snapshot.categories);
  assert.equal(annotated.categories.some((c) => c.key === 'health'), false);
});

test('withInsightNames on a snapshot with nothing detected keeps the nulls rather than inventing blocks', () => {
  const snapshot = buildRadiografiaSnapshot(fixture({
    antExpenses: { monthlyAvg: 0, annualized: 0, items: [] },
    recurring: { monthlyTotal: 0, annualized: 0, count: 0, items: [] },
  }));
  const annotated = withInsightNames(snapshot, { ant: [{ merchant: 'glovo', count: 3 }], recurring: [{ merchant: 'netflix' }] });

  assert.equal(annotated.antExpenses, null);
  assert.equal(annotated.recurring, null);
});
