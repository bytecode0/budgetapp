import { test } from "node:test";
import assert from "node:assert/strict";
import { bpsToPct, emergencyFundTarget, monthLight, pctToBps, shareOfIncome } from "./incomeShare.js";

test("pctToBps: 0–100 with up to two decimals, anything else is null", () => {
  assert.equal(pctToBps(10), 1000);
  assert.equal(pctToBps(0), 0);
  assert.equal(pctToBps(100), 10_000);
  assert.equal(pctToBps(12.5), 1250);
  assert.equal(pctToBps("7,25"), 725);
  assert.equal(pctToBps(0.123), 12);
  assert.equal(pctToBps(-1), null);
  assert.equal(pctToBps(100.01), null);
  assert.equal(pctToBps("abc"), null);
  assert.equal(pctToBps(null), null);
  assert.equal(pctToBps(Number.NaN), null);
  assert.equal(bpsToPct(1250), 12.5);
});

test("shareOfIncome: rounded to the cent, 0 without income or share", () => {
  assert.equal(shareOfIncome(350_000, 1000), 35_000);  // 10 % of 3,500.00
  assert.equal(shareOfIncome(333_333, 1500), 50_000);  // 49,999.95 → 50,000
  assert.equal(shareOfIncome(100, 1), 0);              // 0.01 % of 1.00 = 0.01 cent
  assert.equal(shareOfIncome(0, 1000), 0);
  assert.equal(shareOfIncome(-5, 1000), 0);
  assert.equal(shareOfIncome(350_000, 0), 0);
});

test("the same share follows the income", () => {
  const bps = pctToBps(10)!;
  assert.equal(shareOfIncome(300_000, bps), 30_000);
  assert.equal(shareOfIncome(420_000, bps), 42_000);
});

test("emergency fund: three months of budgeted expenses", () => {
  assert.equal(emergencyFundTarget(210_000), 630_000);
  assert.equal(emergencyFundTarget(0), 0);
  assert.equal(emergencyFundTarget(-1), 0);
});

const base = { spentCents: 0, budgetedCents: 200_000, paidCents: 0, goalCents: null, closed: false };

test("traffic light: nothing to measure is neutral", () => {
  assert.deepEqual(monthLight({ ...base, budgetedCents: 0 }), { light: "neutral", reason: "noBudget", amountCents: 0 });
  assert.deepEqual(monthLight({ ...base, budgetedCents: 0, goalCents: 0 }).light, "neutral");
});

test("traffic light: over the budget wins, with how much", () => {
  const r = monthLight({ ...base, spentCents: 200_001, paidCents: 50_000, goalCents: 40_000 });
  assert.deepEqual(r, { light: "over", reason: "overBudget", amountCents: 1 });
});

test("traffic light: more than 80 % spent is tight; exactly 80 % is still good", () => {
  assert.deepEqual(monthLight({ ...base, spentCents: 160_001 }), { light: "tight", reason: "nearBudget", amountCents: 39_999 });
  assert.equal(monthLight({ ...base, spentCents: 160_000 }).light, "good");
  assert.equal(monthLight({ ...base, spentCents: 200_000 }).light, "tight");
});

test("traffic light: an open month without paying yourself yet stays good, with what's left", () => {
  assert.deepEqual(
    monthLight({ ...base, spentCents: 50_000, paidCents: 10_000, goalCents: 30_000 }),
    { light: "good", reason: "goalPending", amountCents: 20_000 },
  );
});

test("traffic light: a past month that ended without paying yourself is tight", () => {
  assert.deepEqual(
    monthLight({ ...base, spentCents: 50_000, paidCents: 10_000, goalCents: 30_000, closed: true }),
    { light: "tight", reason: "goalMissed", amountCents: 20_000 },
  );
});

test("traffic light: good, with or without a share chosen", () => {
  assert.equal(monthLight({ ...base, spentCents: 50_000, paidCents: 30_000, goalCents: 30_000 }).reason, "goalMet");
  assert.equal(monthLight({ ...base, spentCents: 50_000 }).reason, "onTrack");
  // A share but no budget yet: measured on the share alone.
  assert.equal(monthLight({ ...base, budgetedCents: 0, paidCents: 30_000, goalCents: 30_000 }).reason, "goalMet");
  assert.equal(monthLight({ ...base, budgetedCents: 0, goalCents: 30_000 }).reason, "goalPending");
});

test("traffic light: a past month that ended before the share was chosen is not judged by it", () => {
  const past = { ...base, spentCents: 50_000, paidCents: 0, goalCents: 30_000, closed: true, goalApplies: false };
  assert.deepEqual(monthLight(past), { light: "good", reason: "onTrack", amountCents: 0 });
  // Nothing else to measure: neutral.
  assert.equal(monthLight({ ...past, budgetedCents: 0 }).light, "neutral");
  // Spending is still judged.
  assert.equal(monthLight({ ...past, spentCents: 250_000 }).light, "over");
});
