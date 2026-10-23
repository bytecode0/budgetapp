// Run with:  node --import tsx --test server/lib/debtBalance.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  debtState, splitPayments, monthlyCommitment, inLedger, owedNow, sumOwed, startingBalanceFor, isPaidOff, paidOffByHand,
  type DebtLedger, type LedgerDebt,
} from "./debtBalance.js";

const d = (day: number) => new Date(2026, 9, day); // October 2026
const nov = (day: number) => new Date(2026, 10, day);
const OCT = { start: new Date(2026, 9, 1), end: new Date(2026, 10, 1) };
const NOV = { start: new Date(2026, 10, 1), end: new Date(2026, 11, 1) };

const pass: LedgerDebt = {
  id: "pass", kind: "credit_card", status: "active", paymentMode: "full", accountId: "acc-pass",
  currentBalance: 30000, installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: null,
};
const ledger = (debt: LedgerDebt, l: Partial<Omit<DebtLedger, "debt">> = {}): DebtLedger =>
  ({ debt, purchases: [], payments: [], adjustments: [], ...l });

test("the PASS case: 300 previous + 50 groceries, paid 350 — only 300 is budget spending", () => {
  const l = ledger(pass, {
    purchases: [{ id: "super", amount: 5000, date: d(22) }],
    payments: [{ id: "pay", amount: 35000, date: d(30) }],
  });
  const state = debtState(l);
  assert.equal(state.balance, 0);
  assert.equal(state.previousRemaining, 0);
  assert.deepEqual(splitPayments(l).get("pay"), { toPrevious: 30000, toPurchases: 5000 });
});

test("a purchase grows the live balance but not the pre-existing debt", () => {
  const state = debtState(ledger(pass, { purchases: [{ id: "super", amount: 5000, date: d(22) }] }));
  assert.equal(state.balance, 35000);
  assert.equal(state.previousRemaining, 30000);
});

test("payments go to the pre-existing debt first, across several payments", () => {
  const split = splitPayments(ledger(pass, {
    purchases: [{ id: "p", amount: 10000, date: d(5) }],
    payments: [{ id: "b", amount: 20000, date: d(20) }, { id: "a", amount: 20000, date: d(10) }],
  }));
  assert.deepEqual(split.get("a"), { toPrevious: 20000, toPurchases: 0 });
  assert.deepEqual(split.get("b"), { toPrevious: 10000, toPurchases: 10000 });
});

test("full mode: the budget line is the previous debt at period start, unchanged by paying during it", () => {
  const l = ledger(pass, { payments: [{ id: "pay", amount: 30000, date: d(30) }] });
  assert.equal(monthlyCommitment(l, OCT), 30000);
  assert.equal(monthlyCommitment(l, NOV), 0); // next period: nothing previous left
});

test("full mode: new purchases never enter the budget line", () => {
  const fresh = ledger({ ...pass, currentBalance: 0 }, { purchases: [{ id: "p", amount: 8000, date: d(3) }] });
  assert.equal(monthlyCommitment(fresh, NOV), 0);
});

test("an adjustment after a payment doesn't rewrite that payment, and is owed in its own period", () => {
  // October: 300 previous + 50 groceries, paid 350. 5 Nov: 15 of interest. 10 Nov: paid 15.
  const l = ledger(pass, {
    purchases: [{ id: "super", amount: 5000, date: d(22) }],
    payments: [{ id: "oct", amount: 35000, date: d(30) }, { id: "novpay", amount: 1500, date: nov(10) }],
    adjustments: [{ id: "interest", amount: 1500, date: nov(5) }],
  });
  const split = splitPayments(l);
  assert.deepEqual(split.get("oct"), { toPrevious: 30000, toPurchases: 5000 }); // October untouched
  assert.deepEqual(split.get("novpay"), { toPrevious: 1500, toPurchases: 0 });   // the interest is budget spending
  assert.equal(monthlyCommitment(l, NOV), 1500);
  assert.equal(debtState(l).balance, 0);
});

test("a negative adjustment lowers the pre-existing debt, never below zero", () => {
  const l = ledger(pass, { adjustments: [{ id: "refund", amount: -40000, date: d(3) }] });
  assert.equal(debtState(l).previousRemaining, 0);
  assert.equal(debtState(l).balance, -10000);
});

const sixMonths: LedgerDebt = {
  id: "loan", kind: "installment", status: "active", paymentMode: "installments", accountId: null,
  currentBalance: 30000, installmentsPaid: 0, installmentsTotal: 6, installmentAmount: 5000, minimumPayment: null,
};

test("installments: each payment counts one installment and lowers the balance", () => {
  const l = ledger(sixMonths, { payments: [{ id: "1", amount: 5000, date: d(1) }, { id: "2", amount: 5000, date: d(2) }] });
  const state = debtState(l);
  assert.equal(state.balance, 20000);
  assert.equal(state.installmentsPaid, 2);
  assert.equal(monthlyCommitment(l, NOV), 5000);
});

test("installments: the final payment keeps its own period's line, which drops to 0 the next one", () => {
  const before = Array.from({ length: 5 }, (_, i) => ({ id: String(i), amount: 5000, date: new Date(2026, 4 + i, 5) })); // May–Sep
  const l = ledger({ ...sixMonths, status: "paid_off" }, { payments: [...before, { id: "last", amount: 5000, date: d(5) }] });
  assert.equal(monthlyCommitment(l, OCT), 5000);
  assert.equal(monthlyCommitment(l, NOV), 0);
});

test("a debt without a card account counts every payment in full, even an overpayment", () => {
  const l = ledger(sixMonths, { payments: [{ id: "x", amount: 40000, date: d(1) }] });
  assert.deepEqual(splitPayments(l).get("x"), { toPrevious: 40000, toPurchases: 0 });
});

test("minimum mode keeps the minimum payment while owing, 0 once archived", () => {
  const revolving = ledger({ ...pass, paymentMode: "minimum", minimumPayment: 6000 });
  assert.equal(monthlyCommitment(revolving, NOV), 6000);
  assert.equal(monthlyCommitment(ledger({ ...revolving.debt, status: "archived" }), NOV), 0);
});

test("ledger membership: by date, and by recording time only on the anchor's own day", () => {
  const anchorAt = new Date("2026-10-21T08:05:00Z");
  const recordedLater = new Date("2026-10-21T09:00:00Z");
  // An old card statement imported after the anchor: already inside it.
  assert.equal(inLedger({ date: new Date("2026-09-15T00:00:00Z"), createdAt: recordedLater }, anchorAt), false);
  // A purchase entered as a bare day on the anchor's day, after setting it.
  assert.equal(inLedger({ date: new Date("2026-10-21T00:00:00Z"), createdAt: recordedLater }, anchorAt), true);
  // Same day but recorded before the anchor was set: already inside it.
  assert.equal(inLedger({ date: new Date("2026-10-21T00:00:00Z"), createdAt: new Date("2026-10-21T07:00:00Z") }, anchorAt), false);
  assert.equal(inLedger({ date: new Date("2026-10-22T00:00:00Z"), createdAt: recordedLater }, anchorAt), true);
});

test("a −X correction followed by +X cancels out (no clamping between events)", () => {
  // Typo: balance set to 0, then back to 350; then paid 350 from the bank.
  const l = ledger(pass, {
    purchases: [{ id: "super", amount: 5000, date: d(22) }],
    adjustments: [{ id: "typo", amount: -35000, date: d(23) }, { id: "fix", amount: 35000, date: d(24) }],
    payments: [{ id: "pay", amount: 35000, date: d(30) }],
  });
  assert.deepEqual(splitPayments(l).get("pay"), { toPrevious: 30000, toPurchases: 5000 });
  assert.equal(debtState(l).balance, 0);
});

// ── What's owed: one ledger, one answer ─────────────────────────────────────

const klarnaPlan = { paymentMode: "installments", currentBalance: 0, installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 2 };
// As POST /api/debts stores a plan entered with only its cuota.
const klarna: LedgerDebt = {
  id: "klarna", kind: "bnpl", status: "active", accountId: null, minimumPayment: null,
  ...klarnaPlan, currentBalance: startingBalanceFor(klarnaPlan),
};

test("startingBalanceFor: a plan given only its cuota starts owing its remaining cuotas", () => {
  assert.equal(startingBalanceFor(klarnaPlan), 20000); // (6 − 2) × 50 €
  assert.equal(startingBalanceFor({ ...klarnaPlan, currentBalance: 18000 }), 18000); // a balance given wins
  assert.equal(startingBalanceFor({ ...klarnaPlan, paymentMode: "minimum" }), 0);
  assert.equal(startingBalanceFor({ ...klarnaPlan, installmentsTotal: null }), 0);
  assert.equal(startingBalanceFor({ ...klarnaPlan, installmentsPaid: 9 }), 0); // never negative
});

test("owedNow: a card owes its live balance (purchases included), never below 0", () => {
  assert.equal(owedNow(ledger(pass)), 30000);
  assert.equal(owedNow(ledger(pass, { purchases: [{ id: "super", amount: 5000, date: d(22) }] })), 35000);
  assert.equal(owedNow(ledger(pass, { payments: [{ id: "over", amount: 40000, date: d(30) }] })), 0);
});

test("owedNow follows the ledger: 1 payment → 150 €, a correction to 180 € → 180 € (as the edit form shows)", () => {
  const paid = ledger(klarna, { payments: [{ id: "p3", amount: 5000, date: d(5) }] });
  assert.equal(owedNow(paid), 15000);
  // "I owe 180 € now" with movements recorded → a dated adjustment of +30 €.
  const corrected = ledger(klarna, { payments: [{ id: "p3", amount: 5000, date: d(5) }], adjustments: [{ id: "adj", amount: 3000, date: d(6) }] });
  assert.equal(owedNow(corrected), 18000);
  assert.equal(debtState(corrected).balance, 18000);
});

test("a loan set to 0 by hand is paid off (route decision) and owes nothing", () => {
  assert.equal(paidOffByHand("installment", 0), true);
  assert.equal(paidOffByHand("other", -500), true);
  assert.equal(paidOffByHand("installment", 18000), false);
  // The route stores status paid_off; from then on it owes 0.
  const zeroed: LedgerDebt = { ...klarna, id: "loan", kind: "installment", currentBalance: 0, installmentsTotal: 12, installmentsPaid: 0, status: "paid_off" };
  assert.equal(owedNow(ledger(zeroed)), 0);
});

// Debts entered WITHOUT a balance don't go through startingBalanceFor; their
// first payment takes the balance negative. That's not "paid off".
test("scenario A: minimum-mode debt with no balance stays active after paying its minimum", () => {
  const other: LedgerDebt = {
    id: "other", kind: "other", status: "active", paymentMode: "minimum", accountId: null,
    currentBalance: 0, installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: 10000,
  };
  const paid = ledger(other, { payments: [{ id: "p", amount: 10000, date: d(10) }] });
  assert.equal(debtState(paid).balance, -10000);
  assert.equal(isPaidOff(paid), false);
  assert.equal(monthlyCommitment(paid, NOV), 10000); // the commitment stays
});

test("scenario B: cuota with no count and no balance stays active as installments are paid", () => {
  const plan: LedgerDebt = {
    id: "plan", kind: "installment", status: "active", paymentMode: "installments", accountId: null,
    currentBalance: 0, installmentsPaid: 1, installmentsTotal: null, installmentAmount: 5000, minimumPayment: null,
  };
  assert.equal(isPaidOff(ledger(plan)), false);
  assert.equal(isPaidOff(ledger(plan, { payments: [{ id: "p", amount: 5000, date: d(10) }] })), false);
  assert.equal(monthlyCommitment(ledger(plan), OCT), 5000);
});

test("a minimum-mode debt with a real balance paid down to 0 is paid off", () => {
  const loan: LedgerDebt = {
    id: "loan", kind: "other", status: "active", paymentMode: "minimum", accountId: null,
    currentBalance: 30000, installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: 10000,
  };
  const pay = (n: number) => ({ id: `p${n}`, amount: 10000, date: d(n) });
  assert.equal(isPaidOff(ledger(loan, { payments: [pay(1), pay(2)] })), false);
  assert.equal(isPaidOff(ledger(loan, { payments: [pay(1), pay(2), pay(3)] })), true);
  // An adjustment is balance information too: a 0-anchor debt corrected up and paid back.
  const corrected = ledger({ ...loan, currentBalance: 0 }, { adjustments: [{ id: "a", amount: 10000, date: d(1) }], payments: [pay(2)] });
  assert.equal(isPaidOff(corrected), true);
});

test("cards are never judged paid off", () => {
  assert.equal(isPaidOff(ledger(pass, { payments: [{ id: "pay", amount: 30000, date: d(30) }] })), false);
  assert.equal(paidOffByHand("credit_card", 0), false);
});

test("isPaidOff: by balance or by installment count; an open plan isn't", () => {
  assert.equal(isPaidOff(ledger(klarna)), false);
  assert.equal(isPaidOff(ledger(klarna, { payments: [1, 2, 3, 4].map(n => ({ id: `p${n}`, amount: 5000, date: d(n) })) })), true);
  assert.equal(isPaidOff(ledger({ ...klarna, installmentsPaid: 6 })), true);
});

test("paid-off and archived debts owe nothing; sumOwed only counts active ones", () => {
  assert.equal(owedNow(ledger({ ...klarna, status: "paid_off" })), 0);
  assert.equal(owedNow(ledger({ ...klarna, status: "archived" })), 0);
  // Plan 3.3 as entered (PASS 300 € + Klarna with no balance) = 500 €.
  assert.equal(sumOwed([ledger(pass), ledger(klarna)]), 50000);
  assert.equal(sumOwed([ledger(pass), ledger({ ...klarna, status: "paid_off" })]), 30000);
});
