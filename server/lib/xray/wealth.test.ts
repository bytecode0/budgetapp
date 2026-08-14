import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMovement } from "./wealth.js";

test("wealth: a named obligation paid by transfer is spending, not ambiguous", () => {
  // Rent by bank transfer is very common. Leaving it in "uncertain" excluded it
  // from consumption entirely and inflated the savings rate enormously.
  assert.deepEqual(classifyMovement("Transferencia realizada Alquiler los valles"), { type: "consumption", kind: null });
  assert.equal(classifyMovement("Bizum enviado: seguro coche").type, "consumption");
  assert.equal(classifyMovement("Transferencia Fianza los valles").type, "consumption");
});

test("wealth: a plain transfer with no identifying text stays ambiguous", () => {
  assert.deepEqual(classifyMovement("Bizum Enviado: Sin Concepto"), { type: "uncertain", kind: "transfer" });
  assert.equal(classifyMovement("Transferencia realizada Ana Mariela").type, "uncertain");
});

test("wealth: tithing is giving, wherever the keyword sits in the text", () => {
  assert.deepEqual(classifyMovement("Transferencia realizada Diezmo - Luis Vespa"), { type: "wealth", kind: "giving" });
  assert.equal(classifyMovement("TRANSFERENCIA A IGLESIA DE LAS BUENAS NUEVAS").kind, "giving");
});

test("wealth: savings labels are savings, and beat the transfer heuristic", () => {
  assert.deepEqual(classifyMovement("Transferencia realizada Saving"), { type: "wealth", kind: "savings" });
  assert.equal(classifyMovement("Bizum Enviado: fondo de emergencia").kind, "savings");
  assert.equal(classifyMovement("Bizum Enviado: ahorros").kind, "savings");
});

test("wealth: brokers and crypto are detected as investment", () => {
  for (const c of ["Traspaso a Indexa Capital", "Compra Trade Republic", "COINBASE EUROPE", "Transferencia a MyInvestor"]) {
    assert.equal(classifyMovement(c).kind, "investment", c);
  }
});

test("wealth: bare 'fondo' is NOT investment — it's ambiguous in Spanish", () => {
  // "fondo Maritza" is a Bizum to a person; "fondo de emergencia" is savings.
  // Only qualified phrases ("fondo indexado") may count as investing.
  assert.notEqual(classifyMovement("Bizum Enviado: fondo maritza").kind, "investment");
  assert.equal(classifyMovement("Traspaso a fondo indexado").kind, "investment");
});

test("wealth: substring collisions never produce a false investment", () => {
  // Guards the historical "nETFlix" → "etf" bug.
  assert.equal(classifyMovement("NETFLIX.COM").type, "consumption");
  assert.equal(classifyMovement("Pago con tarjeta PENSIONADO").type, "consumption");
});
