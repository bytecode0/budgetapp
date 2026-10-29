// Run with:  node --import tsx --test shared/ingest/shapes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellShape, headerLooksLikeValue, isShape, parseShapeInput, shapesFromSample } from "./shapes.js";

test("cells become formats", () => {
  const cases: [unknown, string][] = [
    ["", "EMPTY"], [null, "EMPTY"], ["  ", "EMPTY"],
    ["29/10/2026", "dd/mm/yyyy"], ["10/29/2026", "mm/dd/yyyy"], ["03/04/2026", "nn/nn/yyyy"], ["3-4-26", "nn-nn-yy"],
    ["2026-10-29", "yyyy-mm-dd"], ["2026-10-29 14:05:00", "yyyy-mm-dd hh:mm"], ["29.10.2026", "dd.mm.yyyy"],
    ["-1.234,56", "-#.###,##"], ["1,234.56", "#,###.##"], ["-12,34", "-#,##"], ["12.5", "#.#"], ["1.234", "#.###"],
    ["1.234.567", "#.###"], ["(12.34)", "-#.##"], ["12,34-", "-#,##"], ["€ 12,50", "#,## CUR"], ["12.50 EUR", "#.## CUR"],
    ["0", "#"], [45231, "INT"], [-12.5, "-DEC"], [2208.48, "DEC"],
    ["EUR", "CODE3"], ["MERCADONA SA", "TEXT(12)"], ["COMPLETED", "TEXT(9)"], ["Bizum de Ana García", "TEXT(19)"],
  ];
  for (const [raw, shape] of cases) {
    assert.equal(cellShape(raw), shape, String(raw));
    assert.ok(isShape(shape), `generated shape ${shape} must validate`);
  }
});

test("no shape carries a digit, a word or a value from its cell", () => {
  const raw = [
    "29/10/2026", "-1.234,56", "1,234.56", "ES7620770024003102575766", "4111 1111 1111 1111", "MERCADONA 1234",
    "Transferencia a Juan Pérez", "12345678Z", "ana@example.com", "+34 600 123 456", "PAGO RECIBIDO", 1234.56, "Ref. 998877",
  ];
  for (const v of raw) {
    const s = cellShape(v);
    assert.ok(!/\d/.test(s.replace(/^TEXT\(\d+\)$/, "")), `${String(v)} → ${s}`);
    assert.ok(isShape(s), `${String(v)} → ${s}`);
  }
});

test("the validator refuses raw values", () => {
  for (const bad of [
    "MERCADONA", "-12,34", "29/10/2026", "2026-10-29", "ES7620770024003102575766", "12:30", "TEXT(abc)", "TEXT(0)",
    "#1", "EUR", "dd/mm/yyyy; DROP", "-#.##,##,##,##,##,##,##,##", 12, null, "TEXT(1234)",
  ]) {
    assert.equal(isShape(bad), false, String(bad));
  }
});

test("headers: titles pass, values don't", () => {
  for (const ok of ["Fecha", "F.Valor", "Importe (EUR)", "Concepto", "Started Date", "Saldo"]) assert.equal(headerLooksLikeValue(ok), false, ok);
  for (const bad of ["29/10/2026", "-12,34", "ES7620770024003102575766", "ana@example.com", "Cuenta 0049 1234", "x".repeat(41), "1500", "Transferencia a favor de Juan Pérez"]) {
    assert.equal(headerLooksLikeValue(bad), true, bad);
  }
});

test("from a sample: the header row's titles and the shapes of the rows below", () => {
  const rows = [
    ["Movimientos de la cuenta ES7620770024003102575766"],
    ["Fecha", "Concepto", "Importe", "Saldo"],
    ["29/10/2026", "MERCADONA VALENCIA", "-42,10", "1.234,56"],
    ["", "", "", ""],
    ["30/10/2026", "NOMINA ACME SL", "1.500,00", "2.734,56"],
  ];
  const input = shapesFromSample(rows, 1);
  assert.deepEqual(input, {
    headers: ["Fecha", "Concepto", "Importe", "Saldo"],
    shapes: [["dd/mm/yyyy", "TEXT(18)", "-#,##", "#.###,##"], ["dd/mm/yyyy", "TEXT(14)", "#.###,##", "#.###,##"]],
  });
  assert.deepEqual(parseShapeInput(input), { input });
  // A wrongly chosen header row: its values go as "" and the rest still validates.
  const wrong = shapesFromSample(rows, 2);
  assert.deepEqual(wrong.headers, ["", "MERCADONA VALENCIA", "", ""]);
});

test("server: raw values, wrong lengths and junk are refused", () => {
  const ok = { headers: ["Fecha", "Importe"], shapes: [["dd/mm/yyyy", "-#,##"]] };
  assert.ok("input" in parseShapeInput(ok));
  for (const bad of [
    null, [], "x", { headers: [], shapes: [] },
    { ...ok, headers: ["29/10/2026", "Importe"] },
    { ...ok, shapes: [["29/10/2026", "-#,##"]] },
    { ...ok, shapes: [["dd/mm/yyyy", "-12,34"]] },
    { ...ok, shapes: [["dd/mm/yyyy", "MERCADONA"]] },
    { ...ok, shapes: [["dd/mm/yyyy"]] },
    { ...ok, shapes: Array(11).fill(["dd/mm/yyyy", "-#,##"]) },
    { headers: ["", ""], shapes: [["EMPTY", "EMPTY"]] },
    { headers: Array(31).fill("Col"), shapes: [Array(31).fill("EMPTY")] },
  ]) {
    assert.ok("error" in parseShapeInput(bad), JSON.stringify(bad));
  }
});
