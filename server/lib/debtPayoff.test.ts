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

// ── Month-by-month series (LPBETA-02) ──────────────────────────────────────
import { simulatePayoffSeries } from "./debtPayoff.js";

const loan = (id: string, balance: number, apr: number | null, min: number): PayoffDebtInput =>
  ({ id, currentBalance: balance, apr, minimumPayment: min, installmentAmount: null });

test("series: the summary simulatePayoff returns is the series' own totals", () => {
  const debts = [loan("a", 250000, 19.9, 6000), loan("b", 90000, 7, 3000)];
  for (const method of ["snowball", "avalanche"] as const) {
    const s = simulatePayoffSeries(debts, method, { extraPaymentCents: 5000 });
    const sum = simulatePayoff(debts, method, 5000);
    assert.deepEqual({ months: s.months, totalInterestPaid: s.totalInterestPaid, totalPaid: s.totalPaid, payoffOrder: s.payoffOrder }, {
      months: sum.months, totalInterestPaid: sum.totalInterestPaid, totalPaid: sum.totalPaid, payoffOrder: sum.payoffOrder,
    });
    assert.equal(s.series.length, s.months);
    assert.equal(s.series.reduce((x, m) => x + m.interestInMonth, 0), s.totalInterestPaid);
    assert.equal(s.series.reduce((x, m) => x + m.paidInMonth, 0), s.totalPaid);
    assert.equal(s.series.at(-1)!.owed, 0);
    assert.ok(s.converged);
  }
});

test("series: every figure is whole cents and balance = previous + interest − paid, per debt and month", () => {
  const debts = [loan("a", 123457, 23.45, 4321), loan("b", 98765, 11.1, 2345)];
  const s = simulatePayoffSeries(debts, "avalanche", { extraPaymentCents: 1234, oneOff: { month: 3, amountCents: 55555 } });
  let prev = new Map(debts.map(d => [d.id, d.currentBalance]));
  for (const m of s.series) {
    for (const d of m.debts) {
      for (const v of [d.owed, d.paidInMonth, d.interestInMonth]) assert.ok(Number.isInteger(v), `${v} is not whole cents`);
      assert.equal(d.owed, prev.get(d.id)! + d.interestInMonth - d.paidInMonth);
    }
    assert.equal(m.owed, m.debts.reduce((x, d) => x + d.owed, 0));
    prev = new Map(m.debts.map(d => [d.id, d.owed]));
  }
  const perDebtPaid = s.perDebt.reduce((x, d) => x + d.totalPaid, 0);
  assert.equal(perDebtPaid, s.totalPaid);
  // Paid = what was owed + the interest accrued (nothing lost or invented).
  assert.equal(s.totalPaid, 123457 + 98765 + s.totalInterestPaid);
});

test("series: snowball attacks the smallest balance, avalanche the highest APR", () => {
  const debts = [loan("big-high", 300000, 24, 3000), loan("small-low", 40000, 5, 1000)];
  assert.equal(simulatePayoffSeries(debts, "snowball", { extraPaymentCents: 10000 }).payoffOrder[0].id, "small-low");
  const av = simulatePayoffSeries(debts, "avalanche", { extraPaymentCents: 10000 });
  // Month 1: the whole extra goes to the high-APR debt.
  const m1 = av.series[0].debts;
  assert.equal(m1.find(d => d.id === "big-high")!.paidInMonth, 3000 + 10000);
  assert.equal(m1.find(d => d.id === "small-low")!.paidInMonth, 1000);
  const sb = simulatePayoffSeries(debts, "snowball", { extraPaymentCents: 10000 });
  assert.ok(av.totalInterestPaid < sb.totalInterestPaid);
});

test("series: an extra monthly payment and a one-off each cut months and interest", () => {
  const debts = [loan("a", 500000, 18, 12000)];
  const base = simulatePayoffSeries(debts, "avalanche");
  const extra = simulatePayoffSeries(debts, "avalanche", { extraPaymentCents: 10000 });
  const oneOff = simulatePayoffSeries(debts, "avalanche", { oneOff: { month: 2, amountCents: 200000 } });
  for (const r of [extra, oneOff]) {
    assert.ok(r.months < base.months);
    assert.ok(r.totalInterestPaid < base.totalInterestPaid);
  }
  // The one-off lands in its month, on top of the minimum.
  assert.equal(oneOff.series[1].paidInMonth, 12000 + 200000);
  assert.equal(oneOff.series[0].paidInMonth, 12000);
});

test("series: a one-off bigger than everything owed only pays what's owed", () => {
  const r = simulatePayoffSeries([loan("a", 10000, null, 1000)], "snowball", { oneOff: { month: 1, amountCents: 999999 } });
  assert.equal(r.months, 1);
  assert.equal(r.totalPaid, 10000);
});

test("series: zero APR accrues nothing and ends in exactly balance / payment months", () => {
  const r = simulatePayoffSeries([loan("a", 60000, 0, 5000)], "avalanche", { extraPaymentCents: 1000 });
  assert.equal(r.totalInterestPaid, 0);
  assert.equal(r.months, 10);
  assert.ok(r.series.every(m => m.interestInMonth === 0));
});

test("series: interest is rounded to the cent once per debt and month", () => {
  // 1000.01 at 12% → 1% a month → 10.0001 → 10.00 (1000 cents).
  const r = simulatePayoffSeries([loan("a", 100001, 12, 200000)], "avalanche");
  assert.equal(r.series[0].interestInMonth, 1000);
  assert.equal(r.totalPaid, 101001);
});

test("series: solo mínimos (no cascade) ignores extra, one-off and freed minimums", () => {
  const debts = [loan("small", 1000, null, 1000), loan("big", 10000, null, 100)];
  const r = simulatePayoffSeries(debts, "snowball", { cascade: false, extraPaymentCents: 5000, oneOff: { month: 1, amountCents: 5000 } });
  assert.equal(r.perDebt.find(d => d.id === "big")!.monthPaidOff, 100);
  assert.equal(r.months, 100);
  const cascading = simulatePayoffSeries(debts, "snowball");
  assert.ok(cascading.months < r.months);
});

test("series: a payment that never covers the interest stops at the cap, not converged, no payoff month", () => {
  const r = simulatePayoffSeries([loan("a", 1000000, 600, 100)], "snowball");
  assert.equal(r.months, 600);
  assert.equal(r.converged, false);
  assert.equal(r.series.length, 600);
  assert.equal(r.perDebt[0].monthPaidOff, null);
});
