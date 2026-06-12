// Run with:  npx tsx --test server/lib/normalizeMerchant.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMerchant } from "./normalizeMerchant.js";

test("uppercase collapses to lowercase key", () => {
  assert.equal(normalizeMerchant("MERCADONA"), "mercadona");
});

test("strips legal suffix and trailing reference number", () => {
  assert.equal(normalizeMerchant("Mercadona SA 1234"), "mercadona");
});

test("strips accents/diacritics", () => {
  assert.equal(normalizeMerchant("Café López"), "cafe lopez");
  assert.equal(normalizeMerchant("MERCADÓNA"), "mercadona");
});

test("collapses surrounding and inner whitespace", () => {
  assert.equal(normalizeMerchant("  Mercadona   "), "mercadona");
  assert.equal(normalizeMerchant("Burger\tKing"), "burger king");
});

test("empty / nullish input yields empty string", () => {
  assert.equal(normalizeMerchant(""), "");
  assert.equal(normalizeMerchant(null), "");
  assert.equal(normalizeMerchant(undefined), "");
});

test("same shop with different formatting maps to the same key", () => {
  assert.equal(
    normalizeMerchant("Mercadona S.A. 1234"),
    normalizeMerchant("MERCADONA"),
  );
});

test("numeric-only description falls back to cleaned digits rather than empty", () => {
  assert.equal(normalizeMerchant("1234"), "1234");
});
