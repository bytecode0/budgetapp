// Run with:  npx tsx --test server/lib/debtPayoff.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulatePayoff, type PayoffDebtInput } from "./debtPayoff.js";

test("single zero-interest debt: minimum-only payoff time is exact", () => {
  const debt: PayoffDebtInput = { id: "a", currentBalance: 120000, apr: null, minimumPayment: 10000, installmentAmount: null };
  const r = simulatePayoff([debt], "snowball", 0);
  assert.equal(r.months, 12); // 1200 / 100 = 12 months exactly
  assert.equal(r.totalInterestPaid, 0);
  assert.equal(r.totalPaid, 120000);
  assert.deepEqual(r.payoffOrder, [{ id: "a", monthPaidOff: 12 }]);
});

test("already debt-free (zero balance) finishes in 0 months", () => {
  const debt: PayoffDebtInput = { id: "a", currentBalance: 0, apr: 20, minimumPayment: 5000, installmentAmount: null };
  const r = simulatePayoff([debt], "avalanche", 0);
  assert.equal(r.months, 0);
  assert.equal(r.totalInterestPaid, 0);
  assert.deepEqual(r.payoffOrder, []);
});

test("snowball orders smallest balance first regardless of APR", () => {
  const small: PayoffDebtInput = { id: "small", currentBalance: 20000, apr: 5, minimumPayment: 2000, installmentAmount: null };
  const big: PayoffDebtInput = { id: "big", currentBalance: 100000, apr: 25, minimumPayment: 2000, installmentAmount: null };
  const r = simulatePayoff([big, small], "snowball", 5000); // extra cascades to `small` first
  assert.equal(r.payoffOrder[0].id, "small");
});

test("avalanche routes extra payment to the highest-APR debt first, finishing it in fewer months than it would alone on its minimum", () => {
  const lowApr: PayoffDebtInput = { id: "low", currentBalance: 20000, apr: 5, minimumPayment: 2000, installmentAmount: null };
  const highApr: PayoffDebtInput = { id: "high", currentBalance: 100000, apr: 25, minimumPayment: 2000, installmentAmount: null };
  const withExtra = simulatePayoff([lowApr, highApr], "avalanche", 5000);
  const highAlone = simulatePayoff([highApr], "avalanche", 0);
  const highPayoff = withExtra.payoffOrder.find(p => p.id === "high")!;
  assert.ok(highPayoff.monthPaidOff < highAlone.months, "extra payment should accelerate the high-APR debt");
});

test("avalanche pays less total interest than snowball on the same mixed-APR debt set", () => {
  const lowApr: PayoffDebtInput = { id: "low", currentBalance: 20000, apr: 5, minimumPayment: 2000, installmentAmount: null };
  const highApr: PayoffDebtInput = { id: "high", currentBalance: 100000, apr: 25, minimumPayment: 2000, installmentAmount: null };
  const snowball = simulatePayoff([lowApr, highApr], "snowball", 5000);
  const avalanche = simulatePayoff([lowApr, highApr], "avalanche", 5000);
  assert.ok(avalanche.totalInterestPaid <= snowball.totalInterestPaid);
});

test("freed-up minimum from a paid-off debt snowballs onto the next debt (not lost)", () => {
  // "small" (bal 1000, min 1000) clears in month 1. Its minimum then joins the
  // cascade for "big" (bal 10000, min 100, no extra) — so big should pay off
  // faster than it would on its own 100/month minimum (which would take 100 months).
  const small: PayoffDebtInput = { id: "small", currentBalance: 1000, apr: null, minimumPayment: 1000, installmentAmount: null };
  const big: PayoffDebtInput = { id: "big", currentBalance: 10000, apr: null, minimumPayment: 100, installmentAmount: null };
  const r = simulatePayoff([small, big], "snowball", 0);
  const bigPayoff = r.payoffOrder.find(p => p.id === "big")!;
  assert.ok(bigPayoff.monthPaidOff < 100, `expected snowball effect, got ${bigPayoff.monthPaidOff} months`);
});

test("higher APR accrues more total interest than lower APR on an identical balance/minimum", () => {
  const low: PayoffDebtInput = { id: "low", currentBalance: 500000, apr: 5, minimumPayment: 15000, installmentAmount: null };
  const high: PayoffDebtInput = { id: "high", currentBalance: 500000, apr: 25, minimumPayment: 15000, installmentAmount: null };
  const rLow = simulatePayoff([low], "avalanche", 0);
  const rHigh = simulatePayoff([high], "avalanche", 0);
  assert.ok(rHigh.totalInterestPaid > rLow.totalInterestPaid);
});

test("adding extra payment never increases months to payoff", () => {
  const debt: PayoffDebtInput = { id: "a", currentBalance: 300000, apr: 18, minimumPayment: 8000, installmentAmount: null };
  const noExtra = simulatePayoff([debt], "avalanche", 0);
  const withExtra = simulatePayoff([debt], "avalanche", 10000);
  assert.ok(withExtra.months <= noExtra.months);
  assert.ok(withExtra.totalInterestPaid <= noExtra.totalInterestPaid);
});

test("a non-amortizing minimum (interest exceeds payment) hits the safety cap, not an infinite loop", () => {
  // 50% monthly rate on a balance whose minimum barely dents the interest.
  const debt: PayoffDebtInput = { id: "a", currentBalance: 1000000, apr: 600, minimumPayment: 100, installmentAmount: null };
  const r = simulatePayoff([debt], "snowball", 0);
  assert.equal(r.months, 600);
});

test("installmentAmount is used as the minimum when minimumPayment is null", () => {
  const debt: PayoffDebtInput = { id: "a", currentBalance: 30000, apr: null, minimumPayment: null, installmentAmount: 10000 };
  const r = simulatePayoff([debt], "snowball", 0);
  assert.equal(r.months, 3);
});
