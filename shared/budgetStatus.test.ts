import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetedShareTone, sharePct, spentShareTone, toCents } from "./budgetStatus.js";

test("budgeted share of income: green to 90 %, amber to 100 %, red above", () => {
  const income = 200_000; // 2,000.00
  assert.equal(budgetedShareTone(income, 180_000), "good");    // 90 % exactly
  assert.equal(budgetedShareTone(income, 180_001), "warning"); // 90.0005 %
  assert.equal(budgetedShareTone(income, 200_000), "warning"); // 100 % exactly
  assert.equal(budgetedShareTone(income, 200_001), "over");    // one cent more than earned
  assert.equal(budgetedShareTone(income, 1), "good");
});

test("budgeted share: no income or no budget is neutral, not a colour", () => {
  assert.equal(budgetedShareTone(0, 100_000), "neutral");
  assert.equal(budgetedShareTone(200_000, 0), "neutral");
  assert.equal(budgetedShareTone(-5, 100), "neutral");
});

test("spent of budgeted: green to 80 %, amber to 100 %, red above", () => {
  const budget = 100_000;
  assert.equal(spentShareTone(0, budget), "good");
  assert.equal(spentShareTone(80_000, budget), "good");     // 80 % exactly
  assert.equal(spentShareTone(80_001, budget), "warning");
  assert.equal(spentShareTone(90_000, budget), "warning");
  assert.equal(spentShareTone(100_000, budget), "warning"); // 100 % exactly
  assert.equal(spentShareTone(100_001, budget), "over");
  assert.equal(spentShareTone(500, 0), "neutral");
});

test("euros to cents and display percentages", () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(1234.56), 123456);
  assert.equal(sharePct(100_401, 100_000), 100);
  assert.equal(sharePct(1, 3), 33);
  assert.equal(sharePct(5, 0), 0);
});
