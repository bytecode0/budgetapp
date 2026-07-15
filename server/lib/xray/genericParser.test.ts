import { test } from "node:test";
import assert from "node:assert/strict";
import { gridToTransactionsGeneric } from "./genericParser.js";
import type { ColumnMapping } from "./aiColumnMap.js";

// A Santander-like grid with a single signed "Importe" column.
test("generic parser: single signed amount column", () => {
  const grid: unknown[][] = [
    ["Mi banco - movimientos"],
    ["Fecha", "Concepto", "Importe", "Saldo"],
    ["01/05/2026", "NOMINA", "2.500,00", "3.000,00"],
    ["03/05/2026", "MERCADONA", "-84,20", "2.915,80"],
    ["", "", "", ""], // footer/blank
  ];
  const m: ColumnMapping = { headerRow: 1, dateCol: 0, conceptCol: 1, amountCol: 2, debitCol: null, creditCol: null, balanceCol: 3 };
  const txns = gridToTransactionsGeneric(grid, m);
  assert.equal(txns.length, 2);
  assert.equal(txns[0].amount, 2500);
  assert.equal(txns[0].concept, "NOMINA");
  assert.equal(txns[1].amount, -84.2);
  assert.equal(txns[1].balance, 2915.8);
});

// A bank with separate Cargo (debit) / Abono (credit) columns.
test("generic parser: separate debit/credit columns → signed amount", () => {
  const grid: unknown[][] = [
    ["Fecha", "Descripción", "Cargo", "Abono"],
    ["2026-05-01", "Nómina", "", "2500,00"],
    ["2026-05-03", "Alquiler", "800,00", ""],
    ["2026-05-04", "Devolución", "", "15,50"],
  ];
  const m: ColumnMapping = { headerRow: 0, dateCol: 0, conceptCol: 1, amountCol: null, debitCol: 2, creditCol: 3, balanceCol: null };
  const txns = gridToTransactionsGeneric(grid, m);
  assert.equal(txns.length, 3);
  assert.equal(txns[0].amount, 2500);   // credit → positive
  assert.equal(txns[1].amount, -800);   // debit → negative
  assert.equal(txns[2].amount, 15.5);
});

// Debits already stored as negative in the debit column must still come out negative.
test("generic parser: debit column with negative sign stays negative", () => {
  const grid: unknown[][] = [
    ["Fecha", "Concepto", "Cargo", "Abono"],
    ["05/05/2026", "COMPRA", "-42,00", ""],
  ];
  const m: ColumnMapping = { headerRow: 0, dateCol: 0, conceptCol: 1, amountCol: null, debitCol: 2, creditCol: 3, balanceCol: null };
  const txns = gridToTransactionsGeneric(grid, m);
  assert.equal(txns[0].amount, -42);
});
