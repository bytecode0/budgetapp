import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDebt, detectDebtPayments, computeFuturoComprometido } from "./debts.js";

test("classifyDebt: BNPL, payday loan, mortgage and generic installment keywords", () => {
  assert.equal(classifyDebt("KLARNA*PEDIDO 123"), "bnpl");
  assert.equal(classifyDebt("COFIDIS PRESTAMO PERSONAL"), "installment");
  assert.equal(classifyDebt("HIPOTECA VIVIENDA"), "mortgage");
  assert.equal(classifyDebt("VIVUS PRESTAMO RAPIDO"), "payday_loan");
  assert.equal(classifyDebt("BIZUM A JUAN"), null, "an unrelated bizum is not debt");
  assert.equal(classifyDebt("MERCADONA SA 1234"), null, "an unrelated purchase is not debt");
});

test("classifyDebt: whole-word matching (like wealth.ts) avoids false positives", () => {
  assert.equal(classifyDebt("FINANCIACION COCHE RENAULT"), "auto_loan");
  // Generic "financiacion" alone still counts (installment), just not the more
  // specific auto_loan phrase.
  assert.equal(classifyDebt("SUPERMERCADO FINANCIACION XYZ"), "installment");
  // Case/accents/asterisks must not break matching.
  assert.equal(classifyDebt("Hipoteca Vivienda BBVA"), "mortgage");
});

test("detectDebtPayments: classifies each recurring merchant and excludes mortgage from monthlyTotal", () => {
  const recurringItems = [
    { merchant: "klarna pedido", avgAmount: 4500 },
    { merchant: "cofidis prestamo personal", avgAmount: 12000 },
    { merchant: "banco hipoteca", avgAmount: 80000 },
    { merchant: "netflix", avgAmount: 1299 },
  ];
  const txns = [
    { merchant: "klarna pedido", concept: "KLARNA*PEDIDO 123", amount: 4500 },
    { merchant: "cofidis prestamo personal", concept: "COFIDIS PRESTAMO PERSONAL", amount: 12000 },
    { merchant: "banco hipoteca", concept: "HIPOTECA VIVIENDA BANCO", amount: 80000 },
    { merchant: "netflix", concept: "NETFLIX.COM", amount: 1299 },
  ];
  const r = detectDebtPayments(recurringItems, txns);
  assert.equal(r.items.length, 2, "netflix is not debt-like; mortgage is separated out");
  assert.equal(r.monthlyTotal, 4500 + 12000, "mortgage excluded from the % total");
  assert.deepEqual(new Set(r.items.map(i => i.kind)), new Set(["bnpl", "installment"]));
  assert.ok(r.mortgage?.detected);
  assert.equal(r.mortgage?.monthlyAmount, 80000);
});

test("detectDebtPayments: no debt-like recurring merchants -> empty result, mortgage null", () => {
  const r = detectDebtPayments(
    [{ merchant: "netflix", avgAmount: 1299 }],
    [{ merchant: "netflix", concept: "NETFLIX.COM", amount: 1299 }],
  );
  assert.equal(r.monthlyTotal, 0);
  assert.deepEqual(r.items, []);
  assert.equal(r.mortgage, null);
});

test("detectDebtPayments: single-month statement — a debt merchant with no recurring history still counts (regression: was always 0)", () => {
  // No recurring merchants at all — exactly the 1-month statement case where
  // detectRecurringFrom can never find >=2 distinct months.
  const r = detectDebtPayments(
    [],
    [
      { merchant: "klarna pedido", concept: "KLARNA*PEDIDO 123", amount: 4500 },
      { merchant: "mercadona", concept: "MERCADONA SA 1234", amount: 8000 },
    ],
  );
  assert.ok(r.monthlyTotal > 0, "a single clearly-matched debt charge must not score zero");
  assert.equal(r.monthlyTotal, 4500);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].merchant, "klarna pedido");
  assert.equal(r.items[0].kind, "bnpl");
  assert.equal(r.items[0].monthlyAmount, 4500);
});

test("detectDebtPayments: a non-recurring debt merchant appearing multiple times in one statement is averaged", () => {
  const r = detectDebtPayments(
    [],
    [
      { merchant: "cofidis prestamo personal", concept: "COFIDIS PRESTAMO PERSONAL", amount: 10000 },
      { merchant: "cofidis prestamo personal", concept: "COFIDIS PRESTAMO PERSONAL", amount: 12000 },
    ],
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].monthlyAmount, 11000, "averaged across the merchant's occurrences");
});

test("detectDebtPayments: does not double-count a merchant present in both recurring AND raw txns", () => {
  const r = detectDebtPayments(
    [{ merchant: "klarna pedido", avgAmount: 4500 }],
    [
      { merchant: "klarna pedido", concept: "KLARNA*PEDIDO 123", amount: 4500 },
      { merchant: "klarna pedido", concept: "KLARNA*PEDIDO 123", amount: 4500 },
      { merchant: "klarna pedido", concept: "KLARNA*PEDIDO 123", amount: 4500 },
    ],
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.monthlyTotal, 4500, "recurring's averaged amount is used, not re-summed from raw txns");
});

test("detectDebtPayments: a one-off mortgage charge with no recurring history is still detected and excluded from monthlyTotal", () => {
  const r = detectDebtPayments(
    [],
    [{ merchant: "banco hipoteca", concept: "HIPOTECA VIVIENDA BANCO", amount: 80000 }],
  );
  assert.equal(r.monthlyTotal, 0);
  assert.equal(r.items.length, 0);
  assert.ok(r.mortgage?.detected);
  assert.equal(r.mortgage?.monthlyAmount, 80000);
});

test("computeFuturoComprometido: simple percentage of income", () => {
  const r = computeFuturoComprometido(500, 2000);
  assert.equal(r.pctOfIncome, 0.25);
  assert.equal(r.monthlyTotal, 500);
});

test("computeFuturoComprometido: zero income guards against division by zero", () => {
  const r = computeFuturoComprometido(500, 0);
  assert.equal(r.pctOfIncome, 0);
  assert.equal(r.monthlyTotal, 500);
});
