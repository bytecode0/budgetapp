import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStageInputs, type FieldValueRow, type DebtRow } from "./inputs.js";
import { evaluateStage } from "./engine.js";

function cents(euros: number): number {
  return Math.round(euros * 100);
}

// Baseline block-1 answers: 2500 income, 800 housing, 600 essentials
// (base_mensual = 1400€ → colchón floor 700€, fondo floor 4200€), tunable
// per test via overrides.
function fields(overrides: Record<string, number> = {}): FieldValueRow[] {
  const base: Record<string, number> = {
    income_regular: 2500,
    housing_payment: 800,
    essentials_total: 600,
    account_balance: 0,
    assets_cuasi_efectivo: 0,
    ...overrides,
  };
  return Object.entries(base).map(([fieldKey, euros]) => ({ fieldKey, valueCents: cents(euros), source: "manual" }));
}

function classify(fieldOverrides: Record<string, number>, debts: DebtRow[] = [], opts: { hasDebtsAnswer?: boolean; incomeType?: "regular" | "irregular" } = {}) {
  const inputs = buildStageInputs({
    fieldValues: fields(fieldOverrides),
    debts,
    hasDebtsAnswer: opts.hasDebtsAnswer ?? true,
    incomeType: opts.incomeType ?? "regular",
  });
  return evaluateStage(inputs);
}

test("stage engine: no data at all → classifiable false, no stage invented", () => {
  const inputs = buildStageInputs({ fieldValues: [], debts: [], hasDebtsAnswer: false, incomeType: "regular" });
  const result = evaluateStage(inputs);
  assert.equal(result.classifiable, false);
  assert.equal(result.stageId, null);
  assert.ok(result.missing.length > 0);
});

test("stage engine: Etapa 1 (cimientos) — no colchón at all", () => {
  const result = classify({ account_balance: 0, assets_cuasi_efectivo: 0 });
  assert.equal(result.stageId, "cimientos");
  assert.equal(result.branchId, null);
});

test("stage engine: Etapa 1 branch — negative cashflow gets 'cerrando_la_brecha'", () => {
  const result = classify({ income_regular: 1000, housing_payment: 800, essentials_total: 600, account_balance: 0, assets_cuasi_efectivo: 0 });
  assert.equal(result.stageId, "cimientos");
  assert.equal(result.branchId, "cerrando_la_brecha");
});

test("stage engine: colchón exactly at the 0.5x floor counts as HAVING a colchón (inclusive)", () => {
  // base_mensual = 1400€, floor = 700€ exactly
  const result = classify({ account_balance: 700, assets_cuasi_efectivo: 0 }, [], { hasDebtsAnswer: true });
  assert.notEqual(result.stageId, "cimientos");
});

test("stage engine: just below the 0.5x floor is still Etapa 1", () => {
  const result = classify({ account_balance: 699.99, assets_cuasi_efectivo: 0 });
  assert.equal(result.stageId, "cimientos");
});

test("stage engine: Etapa 2 (liberación) — has colchón, has non-mortgage debt", () => {
  const result = classify(
    { account_balance: 700, assets_cuasi_efectivo: 0 },
    [{ kind: "credit_card", monthlyPayment: cents(150), source: "manual" }],
  );
  assert.equal(result.stageId, "liberacion");
});

test("stage engine: a mortgage-only debt does NOT count as 'posee deudas' — skips straight past Etapa 2", () => {
  const result = classify(
    { account_balance: 700, assets_cuasi_efectivo: 0 },
    [{ kind: "mortgage", monthlyPayment: cents(900), source: "manual" }],
  );
  assert.notEqual(result.stageId, "liberacion");
  assert.equal(result.stageId, "terreno_firme");
});

test("stage engine: Etapa 3 (terreno firme) — no debt, colchón but not yet a full fondo", () => {
  const result = classify({ account_balance: 700, assets_cuasi_efectivo: 0 }, [], { hasDebtsAnswer: true });
  assert.equal(result.stageId, "terreno_firme");
});

test("stage engine: fondo exactly at the 3x floor already counts as complete (inclusive)", () => {
  // base_mensual = 1400€, fondo floor = 4200€ exactly
  const result = classify({ account_balance: 4200, assets_cuasi_efectivo: 0 });
  assert.equal(result.stageId, "fortaleza");
});

test("stage engine: Etapa 4 (fortaleza) — no debt, full fondo, not investing", () => {
  const result = classify({ account_balance: 5000, assets_cuasi_efectivo: 0, investment_monthly: 0 });
  assert.equal(result.stageId, "fortaleza");
});

test("stage engine: Etapa 5 (multiplicación) — no debt, full fondo, investing", () => {
  const result = classify({ account_balance: 5000, assets_cuasi_efectivo: 0, investment_monthly: 200 });
  assert.equal(result.stageId, "multiplicacion");
});

test("stage engine: debts_confirmed_none (no ProfileDebt rows, hasDebtsAnswer true) behaves like zero debt", () => {
  const result = classify({ account_balance: 700, assets_cuasi_efectivo: 0 }, [], { hasDebtsAnswer: true });
  assert.equal(result.stageId, "terreno_firme");
});

test("stage engine: irregular income uses income_floor, not income_regular, for the cashflow branch", () => {
  const fieldValues: FieldValueRow[] = [
    { fieldKey: "income_floor", valueCents: cents(1000), source: "manual" },
    { fieldKey: "housing_payment", valueCents: cents(800), source: "manual" },
    { fieldKey: "essentials_total", valueCents: cents(600), source: "manual" },
    { fieldKey: "account_balance", valueCents: 0, source: "manual" },
    { fieldKey: "assets_cuasi_efectivo", valueCents: 0, source: "manual" },
  ];
  const inputs = buildStageInputs({ fieldValues, debts: [], hasDebtsAnswer: true, incomeType: "irregular" });
  const result = evaluateStage(inputs);
  assert.equal(result.stageId, "cimientos");
  assert.equal(result.branchId, "cerrando_la_brecha");
});

test("stage engine: assets_mercado_volatil never counts toward colchón", () => {
  const result = classify({ account_balance: 0, assets_cuasi_efectivo: 0, assets_mercado_volatil: 100000 });
  assert.equal(result.stageId, "cimientos");
});

test("stage engine: precedence (Q6) — manual income wins over a conflicting extracto value", () => {
  const fieldValues: FieldValueRow[] = [
    { fieldKey: "income_regular", valueCents: cents(2500), source: "manual" },
    { fieldKey: "income_regular", valueCents: cents(500), source: "extracto" }, // a short/partial statement would understate it
    { fieldKey: "housing_payment", valueCents: cents(800), source: "manual" },
    { fieldKey: "essentials_total", valueCents: cents(600), source: "manual" },
    { fieldKey: "account_balance", valueCents: cents(700), source: "manual" },
    { fieldKey: "assets_cuasi_efectivo", valueCents: 0, source: "manual" },
  ];
  const inputs = buildStageInputs({ fieldValues, debts: [], hasDebtsAnswer: true, incomeType: "regular" });
  // With the (wrong) extracto income of 500€, cashflow would go negative; with
  // the manual 2500€ it doesn't — this is really asserting which one won.
  assert.equal(inputs.cashflowNet, cents(2500) - cents(800 + 600));
});

test("stage engine: precedence (Q6) — extracto balance wins over a conflicting manual value", () => {
  const fieldValues: FieldValueRow[] = [
    ...fields({ account_balance: 100 }), // manual guess: barely anything
    { fieldKey: "account_balance", valueCents: cents(5000), source: "extracto" }, // the statement says otherwise
  ];
  const inputs = buildStageInputs({ fieldValues, debts: [], hasDebtsAnswer: true, incomeType: "regular" });
  assert.equal(inputs.colchonDisponible, cents(5000));
});

test("stage engine: precedence (Q6) — extracto debts override a manual 'no tengo deudas' answer", () => {
  const fieldValues = fields({ account_balance: 700 });
  const debts: DebtRow[] = [{ kind: "credit_card", monthlyPayment: cents(150), source: "extracto" }];
  const inputs = buildStageInputs({ fieldValues, debts, hasDebtsAnswer: true, incomeType: "regular" });
  const result = evaluateStage(inputs);
  assert.equal(result.stageId, "liberacion");
});

test("stage engine: precedence (Q6) — manual debts still count when no extracto debts exist", () => {
  const fieldValues = fields({ account_balance: 700 });
  const debts: DebtRow[] = [{ kind: "credit_card", monthlyPayment: cents(150), source: "manual" }];
  const inputs = buildStageInputs({ fieldValues, debts, hasDebtsAnswer: true, incomeType: "regular" });
  const result = evaluateStage(inputs);
  assert.equal(result.stageId, "liberacion");
});
