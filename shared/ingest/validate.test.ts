// Run with:  node --import tsx --test shared/ingest/validate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColumnMapping, parseNormalizedRows, parseSkippedRows, parseSource, storedMapping, toWireRows, toWireSkipped } from "./validate.js";

test("mapping: a valid one is kept, unknown keys dropped", () => {
  const r = parseColumnMapping({
    date: "Fecha", debit: "Cargo", credit: "Abono", description: ["Concepto"], dateOrder: "dmy",
    purchasesSign: "positive", evil: "<script>",
  });
  assert.deepEqual(r, { mapping: { date: "Fecha", debit: "Cargo", credit: "Abono", description: ["Concepto"], dateOrder: "dmy", purchasesSign: "positive" } });
});

test("mapping: amount wins over debit/credit when both are sent", () => {
  const r = parseColumnMapping({ date: "Fecha", amount: "Importe", debit: "Cargo", description: [] });
  assert.ok("mapping" in r && r.mapping.amount === "Importe" && r.mapping.debit === undefined);
});

test("mapping: invalid input names the problem", () => {
  for (const bad of [
    null, [], "x", { amount: "Importe", description: [] }, { date: "Fecha", description: [] },
    { date: "Fecha", amount: "Importe", description: "Concepto" }, { date: "Fecha", amount: "Importe", description: [1] },
    { date: "Fecha", amount: "Importe", description: [], dateOrder: "yyyy" },
    { date: "Fecha", amount: "Importe", description: [], decimal: ";" },
    { date: "Fecha", amount: "Importe", description: [], purchasesSign: "up" },
    { date: "x".repeat(200), amount: "Importe", description: [] },
  ]) {
    assert.ok("error" in parseColumnMapping(bad), JSON.stringify(bad));
  }
  assert.equal(storedMapping({ date: "Fecha" }), null);
  assert.equal(storedMapping(null), null);
});

test("rows from the browser: strict cents and days", () => {
  const ok = parseNormalizedRows([{ date: "2026-10-29", amountCents: -1250, description: "Compra", feeCents: 30 }]);
  assert.ok("rows" in ok);
  assert.deepEqual(ok.rows[0], {
    rowIndex: 0, date: "2026-10-29", amountCents: -1250, description: "Compra", details: undefined,
    balanceCents: null, externalRef: null, currency: null, state: null, feeCents: -30,
  });
  for (const bad of [
    [], "rows", [{ date: "29/10/2026", amountCents: 1, description: "" }], [{ date: "2026-02-30", amountCents: 1, description: "" }],
    [{ date: "2026-10-29", amountCents: 12.5, description: "" }], [{ date: "2026-10-29", amountCents: 1 }],
    [{ date: "2026-10-29", amountCents: 1, description: "", balanceCents: "100" }],
  ]) {
    assert.ok("error" in parseNormalizedRows(bad), JSON.stringify(bad));
  }
});

test("skipped rows and source from the browser", () => {
  assert.deepEqual(parseSkippedRows(undefined), { skipped: [] });
  assert.deepEqual(parseSkippedRows([{ rowIndex: 3, reason: "state:PENDING", extra: 1 }]), { skipped: [{ rowIndex: 3, reason: "state:PENDING" }] });
  for (const bad of ["x", [{ rowIndex: -1, reason: "a" }], [{ rowIndex: 1.5, reason: "a" }], [{ rowIndex: 1, reason: "" }], [{ rowIndex: 1, reason: "x".repeat(61) }], [null]]) {
    assert.ok("error" in parseSkippedRows(bad), JSON.stringify(bad));
  }
  assert.equal(parseSource(undefined), "rows");
  assert.equal(parseSource("revolut"), "revolut");
  assert.equal(parseSource("<script>"), null);
});

test("rows as the browser posts them always pass the server's check", () => {
  const long = "x".repeat(900);
  const wire = toWireRows([{
    rowIndex: 7, date: "2026-10-29", amountCents: -100, description: long, details: long,
    externalRef: long, state: "COMPLETED", currency: "EURO", feeCents: null,
  }, { rowIndex: 8, date: "2026-10-30", amountCents: 50, description: "ok", currency: "USD" }]);
  const parsed = parseNormalizedRows(wire);
  assert.ok("rows" in parsed, JSON.stringify(parsed));
  assert.equal(parsed.rows[0].description.length, 500);
  assert.equal(parsed.rows[0].currency, null);
  assert.equal(parsed.rows[1].currency, "USD");
  assert.ok("skipped" in parseSkippedRows(toWireSkipped([{ rowIndex: 1, reason: `state:${"X".repeat(100)}` }])));
});
