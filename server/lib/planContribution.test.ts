// Run with:  node --import tsx --test server/lib/planContribution.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planContribution, planContributions } from "./planContribution.js";

test("MONEY: a refund on a plan line takes money back out of the plan", () => {
  assert.equal(planContribution({ kind: "expense", amount: 5000 }), 5000);
  assert.equal(planContribution({ kind: "refund", amount: 2000 }), -2000);
  assert.equal(planContribution({ amount: 700 }), 700); // legacy rows have no kind
});

test("planContributions: nets per plan, ignores non-plan lines, drops zero nets", () => {
  const lines = new Map([["line-trip", "plan-trip"], ["line-car", "plan-car"]]);
  const out = planContributions([
    { kind: "expense", amount: 10000, allocationId: "line-trip" },
    { kind: "refund", amount: 2500, allocationId: "line-trip" },
    { kind: "expense", amount: 900, allocationId: "line-food" },
    { kind: "expense", amount: 300, allocationId: "line-car" },
    { kind: "refund", amount: 300, allocationId: "line-car" },
    { kind: "expense", amount: 100, allocationId: null },
  ], lines);
  assert.deepEqual([...out], [["plan-trip", 7500]]);
});
