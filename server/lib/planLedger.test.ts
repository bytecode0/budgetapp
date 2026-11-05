// Run with:  node --import tsx --test server/lib/planLedger.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookedByPlan, monthContribution, sumContributions } from "./planLedger.js";

test("with a deposit: the larger of deposit and booked, never both", () => {
  assert.equal(monthContribution(200, 200), 200);
  assert.equal(monthContribution(260, 200), 260);
  assert.equal(monthContribution(0, 150), 150);
  assert.equal(monthContribution(200, -50), 200);
});

test("without a deposit: what was booked, withdrawals included (may be negative)", () => {
  assert.equal(monthContribution(null, 150), 150);
  assert.equal(monthContribution(null, -80), -80);
  assert.equal(monthContribution(null, 0), 0);
});

test("booked per plan nets refunds; a line without a plan counts on its own", () => {
  const booked = bookedByPlan([
    { lifePlanId: "p1", allocationId: "l1", amount: 5000 },
    { lifePlanId: "p1", allocationId: "l1", kind: "refund", amount: 1000 },
    { lifePlanId: null, allocationId: "l9", amount: 700 },
  ]);
  assert.deepEqual([...booked], [["p1", 4000], ["line:l9", 700]]);
});

test("X sums each plan's contribution once and never floors a plan without a deposit", () => {
  const booked = new Map([["p1", 20000], ["line:l9", 700], ["p3", -3000]]);
  assert.equal(sumContributions([{ planId: "p1", amount: 20000 }, { planId: "p2", amount: 5000 }], booked), 20000 + 5000 + 700 - 3000);
  assert.equal(sumContributions([], new Map()), 0);
});
