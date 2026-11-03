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

test("budgeted share: a budget with no income is red; no budget is neutral", () => {
  assert.equal(budgetedShareTone(0, 100_000), "over");
  assert.equal(budgetedShareTone(-5, 100), "over");
  assert.equal(budgetedShareTone(200_000, 0), "neutral");
  assert.equal(budgetedShareTone(0, 0), "neutral");
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
  assert.equal(sharePct(100_000, 100_000), 100);
  assert.equal(sharePct(100_001, 100_000), 101);
  assert.equal(sharePct(80_300, 100_000), 81);
  assert.equal(sharePct(1, 3), 34);
  assert.equal(sharePct(5, 0), 0);
});

test("the % label never contradicts the colour, around every threshold", () => {
  const whole = 123_457; // an awkward total, so most shares aren't whole percentages
  for (let part = 0; part <= whole * 1.2; part += 7) {
    const pct = sharePct(part, whole);
    const spent = spentShareTone(part, whole);
    assert.equal(spent === "good", pct <= 80, `spent ${part}: ${pct}% ${spent}`);
    assert.equal(spent === "over", pct > 100, `spent ${part}: ${pct}% ${spent}`);
    const budgeted = budgetedShareTone(whole, part);
    if (part === 0) continue; // no budget: neutral
    const share = sharePct(part, whole);
    assert.equal(budgeted === "good", share <= 90, `budgeted ${part}: ${share}% ${budgeted}`);
    assert.equal(budgeted === "over", share > 100, `budgeted ${part}: ${share}% ${budgeted}`);
  }
});
