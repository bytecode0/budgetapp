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
  // stability + debtLoad both available (3 months, debtLoad is never N/A) → 6 pillars
  assert.equal(r.health.pillars.length, 6);
  assert.ok(Math.abs(r.health.pillars.reduce((s, p) => s + p.weight, 0) - 1) < 0.001);
});

test("analyze: single-month statement drops the stability pillar but keeps debtLoad", () => {
  const oneMonth = sampleStatement().filter(t => t.date.getMonth() === 4); // May only
  const r = analyze(oneMonth);
  assert.equal(r.period.months, 1);
  assert.equal(r.health.pillars.length, 5, "no stability pillar without ≥2 months, debtLoad still present");
  assert.ok(!r.health.pillars.some(p => p.key === "stability"));
  assert.ok(r.health.pillars.some(p => p.key === "debtLoad"), "debtLoad is never dropped for missing history");
  assert.ok(Math.abs(r.health.pillars.reduce((s, p) => s + p.weight, 0) - 1) < 0.001);
});

test("analyze: zero debt detected always scores debtLoad 100, never N/A", () => {
  const r = analyze(sampleStatement());
  assert.equal(r.debts.monthlyTotal, 0);
  const debtLoad = r.health.pillars.find(p => p.key === "debtLoad");
  assert.ok(debtLoad, "debtLoad pillar is always present");
  assert.equal(debtLoad!.score, 100);
});

test("analyze: detects debt/cuota payments without changing totalExpenses or savingsRate invariants", () => {
  const base = analyze(sampleStatement());
  const rows = sampleStatement();
  for (const month of [5, 6, 7]) {
    rows.push(txn(2026, month, 8, "KLARNA*PEDIDO 4471", -45));
    rows.push(txn(2026, month, 9, "COFIDIS PRESTAMO PERSONAL", -120));
  }
  const withDebt = analyze(rows);

  // The only addition is `result.debts` — debt payments stay counted as
  // expenses exactly like today, nothing is excluded because of this feature.
  const debtMonthly = 45 + 120;
  assert.equal(
    withDebt.summary.totalExpenses,
    Math.round((base.summary.totalExpenses + debtMonthly * 3) * 100) / 100,
  );
  assert.ok(withDebt.summary.savingsRate < base.summary.savingsRate, "more spending → lower savings rate, as before");

  assert.equal(withDebt.debts.monthlyTotal, debtMonthly);
  assert.equal(withDebt.debts.items.length, 2);
  assert.ok(withDebt.debts.items.some(i => i.kind === "bnpl"));
  assert.ok(withDebt.debts.items.some(i => i.kind === "installment"));
  assert.equal(withDebt.debts.mortgage, null);
  assert.ok(withDebt.debts.pctOfIncome > 0);

  // The debt merchants still show up in categories/expenses as before — this
  // feature only ADDS `debts`, it never removes anything from consumption.
  assert.ok(withDebt.health.pillars.length === 6);
});

test("analyze: mortgage is detected but excluded from debts.monthlyTotal and pctOfIncome", () => {
  const rows = sampleStatement();
  for (const month of [5, 6, 7]) rows.push(txn(2026, month, 4, "HIPOTECA VIVIENDA BANCO", -800));
  const r = analyze(rows);
  assert.equal(r.debts.monthlyTotal, 0, "mortgage alone doesn't count toward futuro comprometido");
  assert.ok(r.debts.mortgage?.detected);
  assert.equal(r.debts.mortgage?.monthlyAmount, 800);
  // But it's still a real expense, same as before this feature existed.
  assert.ok(r.summary.totalExpenses > 0);
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
  // 3 identical €50 Bizums → one repeated-amount row keyed by counterparty#cents.
  assert.deepEqual(item.keys, ["t:juan#5000"]);
  assert.equal(item.amountEach, 50);
  const expBefore = base.summary.totalExpenses;
  // Flip via the stable key (not the empty merchant).
  const after = analyze(rows, undefined, { [item.keys[0]]: "consumption" });
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

test("analyze: same counterparty splits by repeated amount, one-offs stay together", () => {
  // The real case: recurring €150 to "Luis Vespa" is a tithe, €300 to the same
  // name is a move to his own savings. One answer can't be right for both.
  const rows = sampleStatement();
  for (const m of [3, 4, 5, 6]) rows.push(txn(2026, m, 5, "TRANSFERENCIA A LUIS VESPA", -150));
  for (const m of [3, 4]) rows.push(txn(2026, m, 6, "TRANSFERENCIA A LUIS VESPA", -300));
  // Three one-off amounts to the same person must NOT become three questions.
  rows.push(txn(2026, 3, 7, "TRANSFERENCIA A LUIS VESPA", -17.5));
  rows.push(txn(2026, 4, 7, "TRANSFERENCIA A LUIS VESPA", -23.9));
  rows.push(txn(2026, 5, 7, "TRANSFERENCIA A LUIS VESPA", -41.2));

  const r = analyze(rows);
  const mine = r.uncertain.items.filter(i => i.detail === "Luis Vespa");
  assert.equal(mine.length, 3, "two repeated amounts + one assorted row");

  const rep150 = mine.find(i => i.amountEach === 150);
  assert.ok(rep150, "150 row exists");
  assert.equal(rep150.count, 4);
  assert.deepEqual(rep150.keys, ["t:luis-vespa#15000"]);

  const assorted = mine.find(i => i.amountEach === null);
  assert.ok(assorted, "assorted row exists");
  assert.equal(assorted.count, 3, "all three one-offs collapsed into one question");
  assert.equal(assorted.keys.length, 3, "but it still carries every key it covers");
});

test("analyze: answering one amount-subgroup leaves the others untouched", () => {
  const rows = sampleStatement();
  for (const m of [3, 4, 5, 6]) rows.push(txn(2026, m, 5, "TRANSFERENCIA A LUIS VESPA", -150));
  for (const m of [3, 4]) rows.push(txn(2026, m, 6, "TRANSFERENCIA A LUIS VESPA", -300));

  const after = analyze(rows, undefined, { "t:luis-vespa#15000": "giving" });
  assert.equal(after.wealth.giving, 600, "4 × 150 became giving");
  // The €300 pair is a different arrangement and must stay unresolved.
  assert.ok(
    after.uncertain.items.some(i => i.amountEach === 300 && i.detail === "Luis Vespa"),
    "the 300 subgroup is still awaiting an answer",
  );
});

test("analyze: an override on the whole counterparty still applies (old sessions)", () => {
  const rows = sampleStatement();
  for (const m of [3, 4, 5]) rows.push(txn(2026, m, 5, "TRANSFERENCIA A LUIS VESPA", -150));
  // Sessions stored before per-amount keys existed used the bare group key.
  const after = analyze(rows, undefined, { "t:luis-vespa": "giving" });
  assert.equal(after.wealth.giving, 450);
});

test("analyze: tax refund is excluded from totalIncome automatically", () => {
  const base = analyze(sampleStatement());
  const rows = sampleStatement();
  rows.push(txn(2026, 6, 20, "Transferencia recibida", 3991.05)); // no keyword → would count
  rows[rows.length - 1].concept = "Transferencia recibida"; // AEAT-style refund below carries it via extra-like concept
  rows.push(txn(2026, 6, 21, "AEAT             apl:declaracion", 1269.65));
  const r = analyze(rows);
  // Only the unlabeled transfer counts; the AEAT refund does not.
  assert.equal(r.summary.totalIncome, Math.round((base.summary.totalIncome + 3991.05) * 100) / 100);
  assert.equal(r.income.excluded.total, 1269.65);
  assert.ok(r.income.excluded.items.some(i => i.reason === "taxRefund"));
});

test("analyze: a received loan is excluded from totalIncome, not counted as earnings", () => {
  const base = analyze(sampleStatement());
  const rows = sampleStatement();
  rows.push(txn(2026, 6, 20, "Bizum | Recibido: prestamo", 200));
  const r = analyze(rows);
  assert.equal(r.summary.totalIncome, base.summary.totalIncome, "loan proceeds don't inflate income");
  assert.equal(r.income.excluded.total, 200);
  assert.ok(r.income.excluded.items.some(i => i.reason === "loanReceived"));
});

test("analyze: a card refund (positive amount, 'pago con tarjeta') is excluded", () => {
  const base = analyze(sampleStatement());
  const rows = sampleStatement();
  rows.push(txn(2026, 6, 20, "Nuva Arganda P4 | Pago con tarjeta 4188202152150916 NUVA ARGANDA P4", 300));
  const r = analyze(rows);
  assert.equal(r.summary.totalIncome, base.summary.totalIncome);
  assert.ok(r.income.excluded.items.some(i => i.reason === "refund"));
});

test("analyze: a cash re-deposit is ambiguous — NOT counted until the user confirms", () => {
  const base = analyze(sampleStatement());
  const rows = sampleStatement();
  rows.push(txn(2026, 6, 20, "Ingreso en efectivo | Bbva oficina", 500));
  const r = analyze(rows);
  assert.equal(r.summary.totalIncome, base.summary.totalIncome, "unconfirmed cash deposit doesn't count yet");
  assert.equal(r.income.uncertain.total, 500);
  const item = r.income.uncertain.items[0];
  assert.ok(item, "shows up for the user to resolve");

  const confirmed = analyze(rows, undefined, { [item.keys[0]]: "income" });
  assert.equal(confirmed.summary.totalIncome, Math.round((base.summary.totalIncome + 500) * 100) / 100);
  assert.equal(confirmed.income.uncertain.total, 0);

  const denied = analyze(rows, undefined, { [item.keys[0]]: "notIncome" });
  assert.equal(denied.summary.totalIncome, base.summary.totalIncome, "marked as not-income stays excluded");
  assert.equal(denied.income.excluded.total, 500);
});

test("analyze: a transfer from a known other-bank account is ambiguous, named by source", () => {
  const rows = sampleStatement();
  rows.push(txn(2026, 6, 20, "Transferencia recibida | Enviada desde N26", 126));
  const r = analyze(rows);
  assert.equal(r.income.uncertain.total, 126);
  assert.equal(r.income.uncertain.items[0].detail, "N26");
});

test("analyze: excluding inflated income lowers savingsRate and giving %, not just the display number", () => {
  // The real bug this fixes: an inflated denominator makes generosity/savings
  // look smaller than they are. Confirm the archetype-relevant ratio moves too.
  const rows = sampleStatement();
  const withRefund = [...rows, txn(2026, 6, 20, "Transferencia recibida | Declaracion IRPF", 5000)];
  const base = analyze(rows);
  const inflated = analyze(withRefund);
  assert.equal(inflated.summary.totalIncome, base.summary.totalIncome, "refund never enters the denominator");
});

test("analyze: 'I.R.P.F.' with dots is still recognized as a tax refund", () => {
  // Punctuation-run normalization turns "i.r.p.f" into four single-letter
  // tokens — the keyword must match that exact space-joined form too.
  const base = analyze(sampleStatement());
  const rows = sampleStatement();
  rows.push(txn(2026, 6, 20, "Transferencia recibida | Declaracion I.R.P.F.", 3991.05));
  const r = analyze(rows);
  assert.equal(r.summary.totalIncome, base.summary.totalIncome, "IRPF refund with dots is still excluded");
  assert.ok(r.income.excluded.items.some(i => i.reason === "taxRefund"));
});
