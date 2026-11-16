// Run with:  node --import tsx --test server/lib/generosity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyGenerosity, firstSortOrder, generosityFirstOrder } from "./generosity.js";

const lines = [
  { id: "g", type: "generosity", allocatedAmount: 1234 },
  { id: "f", type: "fixed", allocatedAmount: 90000 },
];

test("a share sets the Generosity line to that share of the income, and only that line", () => {
  const out = applyGenerosity(lines, 1000, 350_000); // 10 % of 3,500.00
  assert.deepEqual(out.map(l => l.allocatedAmount), [35_000, 90000]);
  // Income changes, same %.
  assert.equal(applyGenerosity(lines, 1000, 420_000)[0].allocatedAmount, 42_000);
});

test("no share keeps the typed amount; 0 % gives 0", () => {
  assert.equal(applyGenerosity(lines, null, 350_000)[0].allocatedAmount, 1234);
  assert.equal(applyGenerosity(lines, 0, 350_000)[0].allocatedAmount, 0);
  assert.equal(applyGenerosity(lines, 1000, 0)[0].allocatedAmount, 0);
});

test("the line is created first in the budget", () => {
  assert.equal(firstSortOrder([]), 0);
  assert.equal(firstSortOrder([0, 1, 2]), -1);
  assert.equal(firstSortOrder([3, -2, 5]), -3);
});

test("Generosity is moved back first, the rest keep their order; already first = no updates", () => {
  const old = [
    { id: "rent", type: "fixed", sortOrder: 0 },
    { id: "groceries", type: "flexible", sortOrder: 1 },
    { id: "gen", type: "generosity", sortOrder: 2 },
    { id: "gym", type: "fixed", sortOrder: 3 },
  ];
  assert.deepEqual(generosityFirstOrder(old), [
    { id: "gen", sortOrder: 0 }, { id: "rent", sortOrder: 1 }, { id: "groceries", sortOrder: 2 },
  ]);
  assert.deepEqual(generosityFirstOrder([
    { id: "gen", type: "generosity", sortOrder: -1 }, { id: "rent", type: "fixed", sortOrder: 0 },
  ]), []);
  // A tie with another line is not "first": renumbered.
  assert.deepEqual(generosityFirstOrder([
    { id: "gen", type: "generosity", sortOrder: 0 }, { id: "rent", type: "fixed", sortOrder: 0 },
  ]), [{ id: "rent", sortOrder: 1 }]);
  assert.deepEqual(generosityFirstOrder([{ id: "rent", type: "fixed", sortOrder: 5 }]), []);
});
