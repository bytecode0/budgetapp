// Run with:  node --import tsx --test server/lib/payYourselfFirst.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedByPlan, planMonthContribution, shareApplies, sumPaidYourself } from "./payYourselfFirst.js";

test("a plan's month contribution is the larger of deposit and booked, never both", () => {
  assert.equal(planMonthContribution(200, 200), 200);
  assert.equal(planMonthContribution(260, 200), 260);
  assert.equal(planMonthContribution(0, 150), 150);
});

test("booked per plan nets refunds; a line without a plan counts on its own", () => {
  const booked = bookedByPlan([
    { lifePlanId: "p1", allocationId: "l1", amount: 5000 },
    { lifePlanId: "p1", allocationId: "l1", kind: "refund", amount: 1000 },
    { lifePlanId: null, allocationId: "l9", amount: 700 },
  ]);
  assert.deepEqual([...booked], [["p1", 4000], ["line:l9", 700]]);
});

test("X sums each plan's contribution once", () => {
  const booked = new Map([["p1", 20000], ["line:l9", 700]]);
  assert.equal(sumPaidYourself([{ planId: "p1", amount: 20000 }, { planId: "p2", amount: 5000 }], booked), 20000 + 5000 + 700);
  assert.equal(sumPaidYourself([], new Map()), 0);
});

test("a share judges a month only if chosen before it ended", () => {
  const end = new Date("2026-11-01T00:00:00Z");
  assert.equal(shareApplies(null, end), true);
  assert.equal(shareApplies(new Date("2026-10-15T00:00:00Z"), end), true);
  assert.equal(shareApplies(new Date("2026-11-03T00:00:00Z"), end), false);
});
