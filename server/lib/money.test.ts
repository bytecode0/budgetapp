// Run with:  npx tsx --test server/lib/money.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toCents, toEuros, serializeMoney } from "./money.js";

test("toCents rounds euros to integer cents", () => {
  assert.equal(toCents(10), 1000);
  assert.equal(toCents(10.5), 1050);
  assert.equal(toCents(10.999), 1100);
  assert.equal(toCents("19.99"), 1999);
});

test("toCents handles nullish / invalid as 0", () => {
  assert.equal(toCents(null), 0);
  assert.equal(toCents(undefined), 0);
  assert.equal(toCents(""), 0);
  assert.equal(toCents("abc"), 0);
});

test("toEuros divides cents back to euros", () => {
  assert.equal(toEuros(1000), 10);
  assert.equal(toEuros(1999), 19.99);
  assert.equal(toEuros(0), 0);
  assert.equal(toEuros(null), 0);
});

test("round-trip is stable for 2-decimal values", () => {
  for (const v of [0, 0.01, 9.99, 1234.56, 100000]) {
    assert.equal(toEuros(toCents(v)), v);
  }
});

test("serializeMoney converts known money keys, leaves others", () => {
  const out = serializeMoney({
    id: "x",
    amount: 1050,
    sortOrder: 3,
    name: "Groceries",
    allocation: { id: "a", allocatedAmount: 50000, icon: "🛒" },
  });
  assert.deepEqual(out, {
    id: "x",
    amount: 10.5,
    sortOrder: 3,
    name: "Groceries",
    allocation: { id: "a", allocatedAmount: 500, icon: "🛒" },
  });
});

test("serializeMoney walks arrays and preserves Dates", () => {
  const d = new Date("2026-01-01T00:00:00Z");
  const out = serializeMoney([{ amount: 200, date: d }, { amount: 350, date: d }]);
  assert.equal(out[0].amount, 2);
  assert.equal(out[1].amount, 3.5);
  assert.equal(out[0].date, d); // same Date reference, untouched
});
