import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetedVsIncome, sharePct, spentShareTone, toCents } from "./budgetStatus.js";

test("budgeted vs income (LPBETA-30): boundaries in integer cents", () => {
  const income = 1_000_000; // 10,000.00
  assert.deepEqual(budgetedVsIncome(income, 849_900), { level: "under", pct: 84 });   // 84.99 %
  assert.deepEqual(budgetedVsIncome(income, 850_000), { level: "near", pct: 85 });    // 85 % exactly
  assert.deepEqual(budgetedVsIncome(income, 999_900), { level: "near", pct: 99 });    // 99.99 %
  assert.deepEqual(budgetedVsIncome(income, 1_000_000), { level: "exact", pct: 100 }); // equal to the cent
  assert.deepEqual(budgetedVsIncome(income, 1_000_100), { level: "over", pct: 101 }); // 100.01 %
  assert.deepEqual(budgetedVsIncome(income, 1_000_001), { level: "over", pct: 101 }); // one cent more
  assert.deepEqual(budgetedVsIncome(income, 999_999), { level: "near", pct: 99 });    // one cent less
  assert.deepEqual(budgetedVsIncome(income, 0), { level: "under", pct: 0 });
});

test("budgeted vs income: no income is neutral, whatever is budgeted", () => {
  assert.deepEqual(budgetedVsIncome(0, 100_000), { level: "noIncome", pct: 0 });
  assert.deepEqual(budgetedVsIncome(0, 0), { level: "noIncome", pct: 0 });
  assert.deepEqual(budgetedVsIncome(-5, 100), { level: "noIncome", pct: 0 });
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
    const { level, pct: share } = budgetedVsIncome(whole, part);
    assert.equal(level === "under", share < 85, `budgeted ${part}: ${share}% ${level}`);
    assert.equal(level === "exact" || level === "over", share >= 100, `budgeted ${part}: ${share}% ${level}`);
    assert.equal(level === "over", share > 100, `budgeted ${part}: ${share}% ${level}`);
  }
});
