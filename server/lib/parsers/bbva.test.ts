import { test } from "node:test";
import assert from "node:assert/strict";
import { gridToTransactions } from "./bbva.js";

// A real BBVA export ships THREE detail columns. Concepto is a generic label and
// the meaning lives in Movimiento / Observaciones — reading only the first one
// silently discarded whatever identified the movement (a tithe, a rent payment,
// a transfer to your own savings), which is what these tests pin down.
const HEADER = ["F.Valor", "Fecha", "Concepto", "Movimiento", "Importe", "Divisa", "Disponible", "Divisa", "Observaciones"];
const row = (concepto: string, movimiento: string, importe: number, observaciones = "") =>
  ["01/08/2026", "01/08/2026", concepto, movimiento, importe, "EUR", 1000, "EUR", observaciones];

test("bbva: captures detail from every concept column, not just the first", () => {
  const [t] = gridToTransactions([HEADER, row("Transferencia realizada", "Diezmo - Luis Vespa", -150)]);
  assert.equal(t.concept, "Transferencia realizada");
  assert.match(t.extra ?? "", /Diezmo - Luis Vespa/);
});

test("bbva: de-duplicates text repeated across columns", () => {
  // Observaciones is usually the uppercased Movimiento; keeping both would
  // duplicate the merchant name and mangle the merchant key.
  const [t] = gridToTransactions([
    HEADER,
    row("Transferencia realizada", "Diezmo - Luis Vespa", -150, "DIEZMO - LUIS VESPA"),
  ]);
  const occurrences = (t.extra ?? "").toLowerCase().split("diezmo").length - 1;
  assert.equal(occurrences, 1);
});

test("bbva: concept stays the primary label so merchant names are unaffected", () => {
  const [t] = gridToTransactions([HEADER, row("Aldi Collado Villalba", "Pago con tarjeta", -34.2)]);
  assert.equal(t.concept, "Aldi Collado Villalba");
});

test("bbva: no extra detail columns → extra is undefined", () => {
  const [t] = gridToTransactions([
    ["Fecha", "Concepto", "Importe"],
    ["01/08/2026", "Mercadona", -20],
  ]);
  assert.equal(t.extra, undefined);
});

test("bbva: blank detail cells are skipped rather than padded", () => {
  const [t] = gridToTransactions([HEADER, row("Bizum", "", -25, "")]);
  assert.equal(t.concept, "Bizum");
  assert.equal(t.extra, undefined);
});
