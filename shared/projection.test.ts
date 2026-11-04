import { test } from "node:test";
import assert from "node:assert/strict";
import { compoundBalance, PROJECTION_RATE_PCTS, PROJECTION_RATES } from "./projection.js";

test("simulator rates: low 3.5 %, medium 5 %, high 7 %, never below 3.5 %", () => {
  assert.deepEqual(PROJECTION_RATE_PCTS, { low: 3.5, medium: 5, high: 7 });
  assert.deepEqual(PROJECTION_RATES, [0.035, 0.05, 0.07]);
  assert.ok(PROJECTION_RATES[0] >= 0.035);
  assert.ok(PROJECTION_RATES[0] < PROJECTION_RATES[1] && PROJECTION_RATES[1] < PROJECTION_RATES[2]);
});

test("compoundBalance: zero rate is linear, month zero is the starting amount", () => {
  assert.equal(compoundBalance(1000, 100, 12, 0), 2200);
  assert.equal(compoundBalance(1000, 100, 0, 0.05), 1000);
});

test("compoundBalance: monthly compounding of the start and the contributions", () => {
  // 1,000 for a year at 6 % (0.5 %/month), no contributions.
  assert.ok(Math.abs(compoundBalance(1000, 0, 12, 0.06) - 1000 * 1.005 ** 12) < 1e-9);
  // 100/month for 12 months at 6 %: annuity factor ((1.005^12 − 1) / 0.005).
  assert.ok(Math.abs(compoundBalance(0, 100, 12, 0.06) - 100 * (1.005 ** 12 - 1) / 0.005) < 1e-9);
  // Higher rate, more money.
  const [low, medium, high] = PROJECTION_RATES.map(r => compoundBalance(0, 200, 240, r));
  assert.ok(low < medium && medium < high);
});
