// Run with:  node --import tsx --test server/lib/ai/merchantInput.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MERCHANT_CHARS, MAX_MERCHANTS, parseMerchantInput, toOriginals } from "./merchantInput.js";

test("a long merchant goes to the AI cut to 100 characters and maps back to what was sent", () => {
  const long = "MERCADONA ".repeat(1000);
  const input = parseMerchantInput([long, "Repsol"]);
  assert.deepEqual(input.merchants, [long.slice(0, MAX_MERCHANT_CHARS), "Repsol"]);
  assert.deepEqual(toOriginals(input, [long.slice(0, MAX_MERCHANT_CHARS)]), [long]);
});

test("names that only differ after the cut share one entry and both get the answer", () => {
  const base = "x".repeat(MAX_MERCHANT_CHARS);
  const input = parseMerchantInput([`${base}A`, `${base}B`]);
  assert.deepEqual(input.merchants, [base]);
  assert.deepEqual(toOriginals(input, [base]), [`${base}A`, `${base}B`]);
});

test("at most 40 distinct names; duplicates, empties and non-strings are dropped", () => {
  const many = Array.from({ length: 100 }, (_, i) => `m${i}`);
  assert.equal(parseMerchantInput(many).merchants.length, MAX_MERCHANTS);
  assert.deepEqual(parseMerchantInput(["a", "a", "", 3, null, { x: 1 }, "b"]).merchants, ["a", "b"]);
});

test("anything that isn't an array is no merchants", () => {
  assert.deepEqual(parseMerchantInput("Mercadona").merchants, []);
  assert.deepEqual(parseMerchantInput(undefined).merchants, []);
  assert.deepEqual(parseMerchantInput({ length: 5 }).merchants, []);
});

test("the cut doesn't split an emoji in half", () => {
  const name = "a".repeat(MAX_MERCHANT_CHARS - 1) + "🛒🛒";
  assert.equal(parseMerchantInput([name]).merchants[0], "a".repeat(MAX_MERCHANT_CHARS - 1) + "🛒");
});

test("a name the AI made up maps to nothing", () => {
  assert.deepEqual(toOriginals(parseMerchantInput(["a"]), ["zzz"]), []);
});
