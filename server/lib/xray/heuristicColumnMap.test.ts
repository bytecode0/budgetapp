import { test } from "node:test";
import assert from "node:assert/strict";
import { mapColumnsHeuristically, validateMapping } from "./heuristicColumnMap.js";
import type { ColumnMapping } from "./aiColumnMap.js";

test("heuristic: single signed amount column, Spanish decimal format", () => {
  const grid: unknown[][] = [
    ["Mi banco - movimientos"],
    ["Fecha", "Concepto", "Importe", "Saldo"],
    ["01/05/2026", "NOMINA", "2.500,00", "4.200,00"],
    ["03/05/2026", "MERCADONA", "-84,20", "4.115,80"],
    ["05/05/2026", "ALQUILER", "-800,00", "3.315,80"],
  ];
  const m = mapColumnsHeuristically(grid);
  assert.ok(m);
  assert.equal(m!.headerRow, 1);
  assert.equal(m!.dateCol, 0);
  assert.equal(m!.conceptCol, 1);
  assert.equal(m!.amountCol, 2);
  assert.equal(m!.balanceCol, 3);
});

test("heuristic: separate debit/credit columns", () => {
  const grid: unknown[][] = [
    ["Fecha", "Descripción", "Cargo", "Abono"],
    ["2026-05-01", "Nómina", "", "2500,00"],
    ["2026-05-03", "Alquiler", "800,00", ""],
    ["2026-05-04", "Devolución", "", "15,50"],
    ["2026-05-05", "Super", "42,00", ""],
    ["2026-05-06", "Gas", "60,00", ""],
  ];
  const m = mapColumnsHeuristically(grid);
  assert.ok(m);
  assert.equal(m!.debitCol, 2);
  assert.equal(m!.creditCol, 3);
  assert.equal(m!.amountCol, null);
});

test("heuristic: English headers and thousands-comma decimal format", () => {
  const grid: unknown[][] = [
    ["Date", "Description", "Amount", "Balance"],
    ["05/01/2026", "PAYROLL", "2,500.00", "4,200.00"],
    ["05/03/2026", "GROCERY STORE", "-84.20", "4,115.80"],
    ["05/05/2026", "RENT", "-800.00", "3,315.80"],
  ];
  const m = mapColumnsHeuristically(grid);
  assert.ok(m);
  assert.equal(m!.dateCol, 0);
  assert.equal(m!.amountCol, 2);
});

test("heuristic: rejects a header row where the 'amount' column is actually the running balance", () => {
  // A malformed export where "Importe" was mislabeled onto what is really the
  // balance column: monotonically increasing, all positive — no charges.
  // This must NOT produce a mapping; it should fall through to the AI path
  // (or unrecognized) rather than build a diagnosis on garbage.
  const grid: unknown[][] = [
    ["Fecha", "Concepto", "Importe"],
    ["01/05/2026", "A", "1000,00"],
    ["02/05/2026", "B", "1200,00"],
    ["03/05/2026", "C", "1350,00"],
    ["04/05/2026", "D", "1500,00"],
    ["05/05/2026", "E", "1620,00"],
  ];
  const m = mapColumnsHeuristically(grid);
  assert.equal(m, null);
});

test("heuristic: returns null when there's no recognizable header at all", () => {
  const grid: unknown[][] = [
    ["random", "junk", "here"],
    ["1", "2", "3"],
  ];
  assert.equal(mapColumnsHeuristically(grid), null);
});

test("validateMapping: rejects when dates don't parse for most rows", () => {
  const grid: unknown[][] = [
    ["Fecha", "Concepto", "Importe"],
    ["not-a-date", "A", "10,00"],
    ["also-not", "B", "-5,00"],
    ["nope", "C", "20,00"],
  ];
  const m: ColumnMapping = { headerRow: 0, dateCol: 0, conceptCol: 1, amountCol: 2, debitCol: null, creditCol: null, balanceCol: null };
  assert.equal(validateMapping(grid, m), false);
});

test("validateMapping: accepts a normal mixed-sign statement", () => {
  const grid: unknown[][] = [
    ["Fecha", "Concepto", "Importe"],
    ["01/05/2026", "A", "1000,00"],
    ["02/05/2026", "B", "-500,00"],
    ["03/05/2026", "C", "-50,00"],
    ["04/05/2026", "D", "200,00"],
    ["05/05/2026", "E", "-20,00"],
  ];
  const m: ColumnMapping = { headerRow: 0, dateCol: 0, conceptCol: 1, amountCol: 2, debitCol: null, creditCol: null, balanceCol: null };
  assert.equal(validateMapping(grid, m), true);
});
