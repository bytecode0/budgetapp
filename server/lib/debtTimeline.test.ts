// Run with:  npx tsx --test server/lib/debtTimeline.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDebtTimeline, type TimelineDebtInput } from "./debtTimeline.js";

const card: TimelineDebtInput = {
  id: "card", name: "Visa", kind: "credit_card", status: "active",
  minimumPayment: 6000, installmentAmount: null, installmentsTotal: null, installmentsPaid: null,
};
const klarna: TimelineDebtInput = {
  id: "klarna", name: "Klarna - sofa", kind: "bnpl", status: "active",
  minimumPayment: null, installmentAmount: 15000, installmentsTotal: 3, installmentsPaid: 1,
};
const paidOffLoan: TimelineDebtInput = {
  id: "loan", name: "Old loan", kind: "installment", status: "paid_off",
  minimumPayment: null, installmentAmount: 20000, installmentsTotal: 12, installmentsPaid: 12,
};

test("revolving credit card recurs every period while active", () => {
  const tl = buildDebtTimeline([card], 250000, 1, 4);
  for (const p of tl) {
    assert.equal(p.committed, 6000);
    assert.deepEqual(p.items.map(i => i.debtId), ["card"]);
  }
});

test("installment plan drops off once its remaining installments run out", () => {
  // klarna has 1/3 paid -> 2 installments remain: this period + next, then gone.
  const tl = buildDebtTimeline([klarna], 250000, 1, 4);
  assert.equal(tl[0].committed, 15000); // period 0: 2nd installment
  assert.equal(tl[1].committed, 15000); // period 1: 3rd (final) installment
  assert.equal(tl[2].committed, 0);     // period 2: fully paid, drops off
  assert.equal(tl[3].committed, 0);
});

test("paid-off debts never appear", () => {
  const tl = buildDebtTimeline([paidOffLoan], 250000, 1, 3);
  for (const p of tl) {
    assert.equal(p.committed, 0);
    assert.deepEqual(p.items, []);
  }
});

test("pctCommitted is committed / income, rounded to one decimal", () => {
  const tl = buildDebtTimeline([card], 200000, 1, 1); // 60/2000 = 3%
  assert.equal(tl[0].pctCommitted, 3);
});

test("pctCommitted is 0 when income is unknown (never divides by zero)", () => {
  const tl = buildDebtTimeline([card], 0, 1, 1);
  assert.equal(tl[0].pctCommitted, 0);
});

test("multiple debts combine correctly per period, and period labels advance", () => {
  const tl = buildDebtTimeline([card, klarna], 250000, 1, 3);
  assert.equal(tl[0].committed, 6000 + 15000);
  assert.equal(tl[1].committed, 6000 + 15000);
  assert.equal(tl[2].committed, 6000); // klarna finished
  assert.equal(tl.length, 3);
  // labels are sequential periods starting from "now"
  const [p0, p1, p2] = tl.map(p => p.period);
  assert.notEqual(p0, p1);
  assert.notEqual(p1, p2);
});

test("respects cycleStartDay via currentPeriodKey (payday=25)", () => {
  const tl = buildDebtTimeline([card], 250000, 25, 2);
  assert.equal(tl.length, 2);
  assert.equal(tl[0].committed, 6000);
});
