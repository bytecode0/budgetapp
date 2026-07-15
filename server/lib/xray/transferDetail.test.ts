import { test } from "node:test";
import assert from "node:assert/strict";
import { describeMovement } from "./transferDetail.js";

test("describeMovement: extracts counterparty name from a bizum", () => {
  const r = describeMovement("BIZUM A JUAN", "transfer");
  assert.equal(r.detail, "Juan");
  assert.equal(r.movementKey, "t:juan");
});

test("describeMovement: multi-word name after 'a favor de'", () => {
  const r = describeMovement("TRANSFERENCIA A FAVOR DE LAURA GOMEZ", "transfer");
  assert.equal(r.detail, "Laura Gomez");
  assert.equal(r.movementKey, "t:laura-gomez");
});

test("describeMovement: masks the account tail when there's no name", () => {
  const r = describeMovement("TRANSFERENCIA A ES12 3456 7890 1234 5678", "transfer");
  assert.equal(r.detail, "••5678");
  assert.equal(r.movementKey, "t:5678");
});

test("describeMovement: no-name, no-digits transfer → unknown group", () => {
  const r = describeMovement("TRANSFERENCIA", "transfer");
  assert.equal(r.detail, null);
  assert.equal(r.movementKey, "t:unknown");
});

test("describeMovement: two identical bizums share a key", () => {
  const a = describeMovement("BIZUM A MARIA", "transfer");
  const b = describeMovement("Bizum a maria", "transfer");
  assert.equal(a.movementKey, b.movementKey);
});

test("describeMovement: cash is namespaced separately and can't collide with merchants", () => {
  const r = describeMovement("RETIRADA CAJERO 1234", "cash");
  assert.ok(r.movementKey.startsWith("c:"));
  assert.equal(r.detail, null);
});

test("describeMovement: movementKey never looks like a normalized merchant", () => {
  // normalizeMerchant only ever produces [a-z0-9 ] — a ':' guarantees no collision.
  for (const c of ["BIZUM A JUAN", "TRANSFERENCIA", "TRASPASO A ES99 8888 7777 6666"]) {
    assert.ok(describeMovement(c, "transfer").movementKey.includes(":"));
  }
});
