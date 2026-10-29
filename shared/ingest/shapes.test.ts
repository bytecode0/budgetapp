// Run with:  node --import tsx --test shared/ingest/shapes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellShape, guessHeaderRow, headerLooksLikeValue, isShape, parseShapeInput, sampleHeaderProblem, shapesFromSample } from "./shapes.js";

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
    // Shapes cellShape() never produces.
    "dd/mm/dd", "#,###.###.###", "dd/mm-yyyy", "yyyy/dd/mm",
  ]) {
    assert.equal(isShape(bad), false, String(bad));
  }
});

test("headers: titles pass, values and personal data don't", () => {
  for (const ok of [
    "Fecha", "F.Valor", "Importe (EUR)", "Concepto", "Started Date", "Saldo", "Card Number", "Exchange Rate",
    "Tipo de movimiento", "FECHA OPERACION", "Transaction Type", "Fecha de pago", "Juan",
  ]) assert.equal(headerLooksLikeValue(ok), false, ok);
  for (const bad of [
    "29/10/2026", "-12,34", "ES7620770024003102575766", "ana@example.com", "Cuenta 0049 1234", "x".repeat(41), "1500",
    "Transferencia a favor de Juan Pérez",
    // The reviewer's probe: names, merchants, ids, phone and account fragments.
    "BIZUM DE JUAN PEREZ", "Luis Peralta García", "COMPRA MERCADONA VALENCIA", "ES91 2100", "ES9121000418",
    "ES 91 21 00 04", "4532 01", "luis.peralta(at)gmail.com", "+34 61 23", "XX12XX34XX56", "TRANSF 12 34",
    "Pago a: María", "DNI 12 34 56 78Z", "IBAN ES91-21-00-04", "61-23-45-67", "12.34", "Nómina OCTUBRE", "1,234",
    "a1b2c3d4e5", "Ana López Ruiz SL",
  ]) {
    assert.equal(headerLooksLikeValue(bad), true, bad);
  }
});

const STATEMENT = [
  ["Movimientos de la cuenta ES7620770024003102575766"],
  ["Fecha", "Concepto", "Importe", "Saldo"],
  ["29/10/2026", "MERCADONA VALENCIA", "-42,10", "1.234,56"],
  ["", "", "", ""],
  ["30/10/2026", "NOMINA ACME SL", "1.500,00", "2.734,56"],
];

test("from a sample: the header row's titles, their formats and the shapes of the rows below", () => {
  const res = shapesFromSample(STATEMENT, 1);
  assert.ok("input" in res);
  assert.deepEqual(res.input, {
    headers: ["Fecha", "Concepto", "Importe", "Saldo"],
    headerShapes: ["TEXT(5)", "TEXT(8)", "TEXT(7)", "TEXT(5)"],
    shapes: [["dd/mm/yyyy", "TEXT(18)", "-#,##", "#.###,##"], ["dd/mm/yyyy", "TEXT(14)", "#.###,##", "#.###,##"]],
  });
  assert.deepEqual(parseShapeInput(res.input), { input: res.input });
});

test("a data row chosen as the header row sends nothing", () => {
  // A data row: its values aren't blanked and sent, the whole row is refused.
  assert.deepEqual(shapesFromSample(STATEMENT, 2), { problem: "values" });
  // A headerless CSV (the reviewer's probe): no row can be the header.
  const headerless = [["29/10/2026", "BIZUM DE JUAN PEREZ", "-12,50", "1.234,56"], ["28/10/2026", "MERCADONA", "-30,00", "1.247,06"]];
  assert.deepEqual(shapesFromSample(headerless, 0), { problem: "values" });
  assert.equal(guessHeaderRow(headerless), -1);
  // A continuation row with only text: it has the formats of the rows below.
  const continuation = [
    ["Fecha", "Concepto", "Importe"],
    ["", "BIZUM DE JUAN PEREZ", ""],
    ["29/10/2026", "MERCADONA", "-30,00"],
    ["30/10/2026", "LIDL", "-12,00"],
  ];
  assert.equal(sampleHeaderProblem(continuation, 1), "data");
  assert.deepEqual(shapesFromSample(continuation, 1), { problem: "data" });
  // A row with no titles at all, or none chosen.
  assert.equal(sampleHeaderProblem(STATEMENT, 3), "empty");
  assert.equal(sampleHeaderProblem(STATEMENT, -1), "empty");
  // A header row whose titles look like names: refused for the AI, not blanked.
  const names = [["Fecha", "Ana López Ruiz", "Importe"], ["29/10/2026", "MERCADONA", "-30,00"]];
  assert.deepEqual(shapesFromSample(names, 0), { problem: "titles" });
});

test("guessing the header row: never a data row, known titles first", () => {
  assert.equal(guessHeaderRow(STATEMENT), 1);
  // The real header has a blank cell, so a data row is fuller: still the header.
  const blankCell = [
    ["Fecha", "", "Importe", "Saldo"],
    ["29/10/2026", "MERCADONA", "-42,10", "1.234,56"],
    ["30/10/2026", "NOMINA", "1.500,00", "2.734,56"],
  ];
  assert.equal(guessHeaderRow(blankCell), 0);
  // Unknown titles are found by their shape alone.
  const unknown = [["Extracto de cuenta"], ["Día", "Qué", "Cuánto"], ["29/10/2026", "LIDL", "-12,00"]];
  assert.equal(guessHeaderRow(unknown), 1);
  // Dates written as text: known titles still make a header row.
  const textDates = [["Fecha", "Concepto", "Importe"], ["29 oct 2026", "LIDL", "-12,00"], ["30 oct 2026", "BAR", "-3,00"]];
  assert.equal(sampleHeaderProblem(textDates, 0), null);
});

test("server: raw values, data rows, wrong lengths and junk are refused", () => {
  const ok = { headers: ["Fecha", "Importe"], headerShapes: ["TEXT(5)", "TEXT(7)"], shapes: [["dd/mm/yyyy", "-#,##"]] };
  assert.ok("input" in parseShapeInput(ok));
  for (const bad of [
    null, [], "x", { headers: [], headerShapes: [], shapes: [] },
    { ...ok, headers: ["29/10/2026", "Importe"] },
    { ...ok, headerShapes: undefined },
    { ...ok, headerShapes: ["TEXT(5)"] },
    { ...ok, headerShapes: ["dd/mm/yyyy", "TEXT(7)"] },
    { ...ok, shapes: [["29/10/2026", "-#,##"]] },
    { ...ok, shapes: [["dd/mm/yyyy", "-12,34"]] },
    { ...ok, shapes: [["dd/mm/yyyy", "MERCADONA"]] },
    { ...ok, shapes: [["dd/mm/yyyy"]] },
    { ...ok, shapes: Array(11).fill(["dd/mm/yyyy", "-#,##"]) },
    { headers: ["", ""], headerShapes: ["EMPTY", "EMPTY"], shapes: [["EMPTY", "EMPTY"]] },
    { headers: Array(31).fill("Col"), headerShapes: Array(31).fill("TEXT(3)"), shapes: [Array(31).fill("EMPTY")] },
    // The old blanking of a data row (the reviewer's probe): a name passes as a title no more…
    { headers: ["", "BIZUM DE JUAN PEREZ", "", ""], headerShapes: ["EMPTY", "TEXT(19)", "EMPTY", "EMPTY"], shapes: [["dd/mm/yyyy", "TEXT(9)", "-#,##", "#.###,##"]] },
    // …and a text-only data row is refused by its shapes, whatever its words.
    { headers: ["", "Mercadona", ""], headerShapes: ["EMPTY", "TEXT(9)", "EMPTY"], shapes: [["dd/mm/yyyy", "TEXT(4)", "-#,##"]] },
  ]) {
    assert.ok("error" in parseShapeInput(bad), JSON.stringify(bad));
  }
  // Odd but well-formed shapes are formats, not values.
  for (const sh of ["TEXT(123)", "TEXT(999)", "-#.###,## CUR", "#'###"]) {
    assert.ok("input" in parseShapeInput({ headers: ["Fecha", "Importe"], headerShapes: ["TEXT(5)", "TEXT(7)"], shapes: [["dd/mm/yyyy", sh]] }), sh);
  }
});
