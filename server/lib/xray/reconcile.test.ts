import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, type ReconInput } from "./reconcile.js";

const out = (cents: number, day: number, fileIndex: number, concept = "TRASPASO A AHORRO"): ReconInput =>
  ({ kind: "expense", cents, date: new Date(2026, 4, day), fileIndex, concept, movementType: "wealth", movementKind: "savings" });
const inn = (cents: number, day: number, fileIndex: number, concept = "TRASPASO DESDE CUENTA"): ReconInput =>
  ({ kind: "income", cents, date: new Date(2026, 4, day), fileIndex, concept, movementType: "consumption", movementKind: null });

test("reconcile: exact cross-file pair within window matches", () => {
  const r = reconcile([out(60000, 10, 0), inn(60000, 11, 1)]);
  assert.equal(r.count, 1);
  assert.equal(r.internal.size, 2);
  assert.equal(r.totalCents, 60000);
});

test("reconcile: same-file pair does NOT match", () => {
  const r = reconcile([out(60000, 10, 0), inn(60000, 10, 0)]);
  assert.equal(r.count, 0);
});

test("reconcile: single file is a no-op", () => {
  const r = reconcile([out(60000, 10, 0), inn(60000, 11, 0)]);
  assert.equal(r.count, 0);
  assert.equal(r.internal.size, 0);
});

test("reconcile: outside the date window does not match", () => {
  const r = reconcile([out(60000, 1, 0), inn(60000, 20, 1)]);
  assert.equal(r.count, 0);
});

test("reconcile: two outflows + one inflow → exactly one match", () => {
  const r = reconcile([out(60000, 10, 0), out(60000, 10, 0), inn(60000, 10, 1)]);
  assert.equal(r.count, 1);
  assert.equal(r.internal.size, 2);
});

test("reconcile: salary inflow is never transfer-like, so never matches", () => {
  const r = reconcile([out(200000, 10, 0), inn(200000, 10, 1, "NOMINA EMPRESA")]);
  assert.equal(r.count, 0);
});

test("reconcile: different amounts do not match", () => {
  const r = reconcile([out(60000, 10, 0), inn(59900, 10, 1)]);
  assert.equal(r.count, 0);
});
