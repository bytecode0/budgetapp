import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./analyze.js";
import type { ParsedTxn } from "../parsers/bbva.js";

// Build a synthetic 3-month statement (May–Jul 2026).
function txn(y: number, m: number, d: number, concept: string, amount: number): ParsedTxn {
  return { date: new Date(y, m - 1, d), concept, amount, balance: null };
}

function sampleStatement(): ParsedTxn[] {
  const rows: ParsedTxn[] = [];
  for (const month of [5, 6, 7]) {
    rows.push(txn(2026, month, 1, "NOMINA EMPRESA SL", 2000));      // income
    rows.push(txn(2026, month, 2, "NETFLIX.COM", -12.99));           // recurring
    rows.push(txn(2026, month, 3, "SPOTIFY AB", -9.99));             // recurring
    // volatile supermarket (not recurring)
    rows.push(txn(2026, month, 5, "MERCADONA SA 1234", -[80, 140, 55][month - 5]));
    // ant: small, frequent coffee — stable price but below the recurring floor
    for (const day of [6, 12, 18, 24]) rows.push(txn(2026, month, day, "CAFETERIA CENTRAL", -2.5));
  }
  return rows;
}

test("analyze: summary totals are correct", () => {
  const r = analyze(sampleStatement());
  assert.equal(r.summary.totalIncome, 6000);
  // expenses: netflix 3*12.99 + spotify 3*9.99 + mercadona (80+140+55) + coffee 12*2.5
  const expected = 3 * 12.99 + 3 * 9.99 + (80 + 140 + 55) + 12 * 2.5;
  assert.equal(r.summary.totalExpenses, Math.round(expected * 100) / 100);
  assert.equal(r.period.months, 3);
  assert.ok(r.summary.savingsRate > 0 && r.summary.savingsRate < 1);
});

test("analyze: detects recurring subscriptions, not the coffee", () => {
  const r = analyze(sampleStatement());
  const merchants = r.recurring.items.map(i => i.merchant);
  assert.ok(merchants.some(m => m.includes("netflix")), "netflix should be recurring");
  assert.ok(merchants.some(m => m.includes("spotify")), "spotify should be recurring");
  assert.ok(!merchants.some(m => m.includes("cafeteria")), "coffee is a leak, not recurring");
  assert.equal(r.recurring.count, 2);
  // annualized ≈ (12.99 + 9.99) * 12
  assert.ok(Math.abs(r.recurring.annualized - (12.99 + 9.99) * 12) < 0.5);
});

test("analyze: detects the coffee as a gasto hormiga with annual projection", () => {
  const r = analyze(sampleStatement());
  const coffee = r.antExpenses.items.find(i => i.merchant.includes("cafeteria"));
  assert.ok(coffee, "coffee should be flagged as ant");
  assert.equal(coffee!.count, 12);
  assert.equal(coffee!.avgTicket, 2.5);
  // 12 coffees over 3 months → 4/month → annualized 48 * 2.5 = 120
  assert.ok(Math.abs(r.antExpenses.annualized - 120) < 1, `got ${r.antExpenses.annualized}`);
});

test("analyze: categories include supermarket and are sorted by total", () => {
  const r = analyze(sampleStatement());
  assert.ok(r.categories.some(c => c.key === "supermarket"));
  for (let i = 1; i < r.categories.length; i++) {
    assert.ok(r.categories[i - 1].total >= r.categories[i].total, "categories sorted desc");
  }
  const pctSum = r.categories.reduce((s, c) => s + c.pct, 0);
  assert.ok(Math.abs(pctSum - 1) < 0.001, "category pct sums to 1");
});

test("analyze: health index is a valid 0–100 composite", () => {
  const r = analyze(sampleStatement());
  assert.ok(r.health.score >= 0 && r.health.score <= 100);
  assert.ok(["building", "balancing", "growing", "solid"].includes(r.health.stage));
  // stability pillar is available (3 months) → 5 pillars, weights sum to 1
  assert.equal(r.health.pillars.length, 5);
  assert.ok(Math.abs(r.health.pillars.reduce((s, p) => s + p.weight, 0) - 1) < 0.001);
});

test("analyze: single-month statement drops the stability pillar", () => {
  const oneMonth = sampleStatement().filter(t => t.date.getMonth() === 4); // May only
  const r = analyze(oneMonth);
  assert.equal(r.period.months, 1);
  assert.equal(r.health.pillars.length, 4, "no stability pillar without ≥2 months");
  assert.ok(!r.health.pillars.some(p => p.key === "stability"));
});

test("analyze: savings/investment transfers are NOT counted as expenses", () => {
  const rows = sampleStatement();
  // Add wealth movements each month: a broker deposit and a savings transfer.
  for (const month of [5, 6, 7]) {
    rows.push(txn(2026, month, 15, "TRADE REPUBLIC", -300));
    rows.push(txn(2026, month, 16, "TRASPASO A CUENTA AHORRO", -200));
  }
  const r = analyze(rows);
  // Expenses must exclude the 500/month of wealth movements.
  const consumptionOnly = 3 * 12.99 + 3 * 9.99 + (80 + 140 + 55) + 12 * 2.5;
  assert.equal(r.summary.totalExpenses, Math.round(consumptionOnly * 100) / 100);
  assert.ok(r.wealth.total > 0, "wealth detected");
  assert.equal(r.wealth.investment, 900, "3×300 investment");
  assert.equal(r.wealth.savings, 600, "3×200 savings");
  // Savings rate should be high, not tanked by the transfers.
  assert.ok(r.summary.savingsRate > 0.8, `savings rate healthy (got ${r.summary.savingsRate})`);
});

test("analyze: ambiguous transfers land in 'uncertain', identified and flippable by key", () => {
  const rows = sampleStatement();
  for (const month of [5, 6, 7]) rows.push(txn(2026, month, 20, "BIZUM A JUAN", -50));
  const base = analyze(rows);
  assert.ok(base.uncertain.total > 0, "uncertain bucket populated");
  const item = base.uncertain.items[0];
  assert.equal(item.detail, "Juan", "counterparty identified from concept");
  assert.equal(item.key, "t:juan");
  const expBefore = base.summary.totalExpenses;
  // Flip via the stable key (not the empty merchant).
  const after = analyze(rows, undefined, { [item.key]: "consumption" });
  assert.ok(after.summary.totalExpenses > expBefore, "marking as spending increases expenses");
  assert.ok(after.uncertain.total < base.uncertain.total, "moved out of uncertain");
});

test("analyze: internal transfers between uploaded accounts are reconciled out", () => {
  // File 0 = checking; File 1 = savings. A €600 monthly transfer appears as an
  // outflow in checking and an inflow in savings → internal, not income/expense.
  const rows: (ParsedTxn & { fileIndex?: number })[] = [];
  for (const month of [5, 6, 7]) {
    rows.push({ ...txn(2026, month, 1, "NOMINA EMPRESA", 2000), fileIndex: 0 });
    rows.push({ ...txn(2026, month, 5, "MERCADONA", -100), fileIndex: 0 });
    rows.push({ ...txn(2026, month, 10, "TRASPASO A AHORRO", -600), fileIndex: 0 });
    rows.push({ ...txn(2026, month, 11, "TRASPASO DESDE CUENTA CORRIENTE", 600), fileIndex: 1 });
  }
  const r = analyze(rows);
  assert.equal(r.internalTransfers.count, 3, "3 monthly internal transfers matched");
  assert.equal(r.internalTransfers.total, 1800);
  // Income counts salary only (3×2000), NOT the 600 inflows.
  assert.equal(r.summary.totalIncome, 6000);
  // Expenses count Mercadona only (3×100), NOT the 600 outflows.
  assert.equal(r.summary.totalExpenses, 300);
  // The savings transfer is internal, so it is NOT double-counted as wealth.
  assert.equal(r.wealth.total, 0);
});

test("analyze: reconciliation leaves savingsRate identical to the no-transfer baseline", () => {
  const base: (ParsedTxn & { fileIndex?: number })[] = [];
  for (const month of [5, 6, 7]) {
    base.push({ ...txn(2026, month, 1, "NOMINA EMPRESA", 2000), fileIndex: 0 });
    base.push({ ...txn(2026, month, 5, "MERCADONA", -100), fileIndex: 0 });
  }
  const withTransfers = [...base];
  for (const month of [5, 6, 7]) {
    withTransfers.push({ ...txn(2026, month, 10, "TRASPASO A AHORRO", -600), fileIndex: 0 });
    withTransfers.push({ ...txn(2026, month, 11, "TRASPASO DESDE CUENTA", 600), fileIndex: 1 });
  }
  assert.equal(
    Math.round(analyze(base).summary.savingsRate * 1000),
    Math.round(analyze(withTransfers).summary.savingsRate * 1000),
    "internal transfers don't move the savings rate",
  );
});

test("analyze: liquid balance = latest movement's running balance", () => {
  const b = (y: number, m: number, d: number, c: string, a: number, bal: number): ParsedTxn =>
    ({ date: new Date(y, m - 1, d), concept: c, amount: a, balance: bal });
  const rows = [
    b(2026, 5, 1, "NOMINA EMPRESA", 2000, 2000),
    b(2026, 5, 10, "MERCADONA", -100, 1900),
    b(2026, 5, 20, "MERCADONA", -50, 1850),
  ];
  const r = analyze(rows);
  assert.equal(r.balances.hasData, true);
  assert.equal(r.balances.total, 1850);
  assert.equal(r.balances.accounts.length, 1);
  assert.ok((r.balances.runwayMonths ?? 0) > 0);
});

test("analyze: liquid balance sums the latest balance of each account", () => {
  const b = (y: number, m: number, d: number, c: string, a: number, bal: number, fileIndex: number): ParsedTxn & { fileIndex?: number } =>
    ({ date: new Date(y, m - 1, d), concept: c, amount: a, balance: bal, fileIndex });
  const rows = [
    b(2026, 5, 1, "NOMINA EMPRESA", 2000, 2000, 0),
    b(2026, 5, 20, "MERCADONA", -100, 1900, 0),
    b(2026, 5, 5, "INTERES", 10, 510, 1),
    b(2026, 5, 25, "APORTACION", 600, 1110, 1),
  ];
  const r = analyze(rows);
  assert.equal(r.balances.total, 1900 + 1110);
  assert.equal(r.balances.accounts.length, 2);
});

test("analyze: no balance column → balances.hasData is false", () => {
  const r = analyze(sampleStatement()); // sample rows carry balance: null
  assert.equal(r.balances.hasData, false);
  assert.equal(r.balances.total, 0);
  assert.equal(r.balances.runwayMonths, null);
});

test("analyze: produces opportunities backed by numbers", () => {
  const r = analyze(sampleStatement());
  assert.ok(r.opportunities.length > 0);
  assert.ok(r.opportunities.some(o => o.id === "emergency_fund"));
  // sorted by saving desc
  for (let i = 1; i < r.opportunities.length; i++) {
    assert.ok(r.opportunities[i - 1].annualSaving >= r.opportunities[i].annualSaving);
  }
});
