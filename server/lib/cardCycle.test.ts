// Run with:  node --import tsx --test server/lib/cardCycle.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampedDay, statementClosingIn, nextStatementDue, statementsDueIn, cycleDaysOf,
  cardCycleSummary, cycleCommitments, isoDay,
} from "./cardCycle.js";
import type { DebtLedger, LedgerDebt } from "./debtBalance.js";
import { buildDebtTimeline } from "./debtTimeline.js";
import { periodBounds, periodKeyOffset } from "./period.js";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const at = (s: string) => new Date(s); // a full instant
const day = (d: Date) => isoDay(d);

// Cut-off on the 25th, due on the 5th of the next month (a typical Spanish card).
const C25_5 = { statementDay: 25, paymentDueDay: 5 };

const card = (over: Partial<LedgerDebt> = {}): LedgerDebt => ({
  id: "visa", kind: "credit_card", status: "active", paymentMode: "full", accountId: "acc-visa",
  currentBalance: 0, installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: null,
  statementDay: 25, paymentDueDay: 5, balanceAsOf: D("2026-09-01"),
  ...over,
});
const ledger = (debt: LedgerDebt, l: Partial<Omit<DebtLedger, "debt">> = {}): DebtLedger =>
  ({ debt, purchases: [], payments: [], adjustments: [], ...l });
const mv = (id: string, amount: number, date: string) => ({ id, amount, date: D(date) });
const periods = (from: string, n: number, cycleStartDay = 1) =>
  Array.from({ length: n }, (_, i) => periodBounds(periodKeyOffset(from, i), cycleStartDay));

// ── Date math ──────────────────────────────────────────────────────────────

test("clampedDay clamps to the month's length, leap years included", () => {
  assert.equal(day(clampedDay(2026, 1, 31)), "2026-02-28");
  assert.equal(day(clampedDay(2028, 1, 31)), "2028-02-29");
  assert.equal(day(clampedDay(2026, 3, 31)), "2026-04-30");
  assert.equal(day(clampedDay(2026, 0, 31)), "2026-01-31");
  // Month overflow rolls into the next / previous year.
  assert.equal(day(clampedDay(2026, 12, 31)), "2027-01-31");
  assert.equal(day(clampedDay(2026, -1, 15)), "2025-12-15");
});

test("a statement is due next month when the due day isn't after the cut-off day", () => {
  const s = statementClosingIn(2026, 9, C25_5); // October
  assert.equal(day(s.closesOn), "2026-10-25");
  assert.equal(day(s.boundary), "2026-10-26");
  assert.equal(day(s.dueOn), "2026-11-05");
});

test("a statement is due the same month when the due day is after the cut-off day", () => {
  const s = statementClosingIn(2026, 9, { statementDay: 5, paymentDueDay: 20 });
  assert.equal(day(s.closesOn), "2026-10-05");
  assert.equal(day(s.dueOn), "2026-10-20");
});

test("due day equal to the cut-off day is next month", () => {
  assert.equal(day(statementClosingIn(2026, 9, { statementDay: 10, paymentDueDay: 10 }).dueOn), "2026-11-10");
});

test("day 31 cut-off in February closes on the last day, leap year or not", () => {
  const days = { statementDay: 31, paymentDueDay: 10 };
  assert.equal(day(statementClosingIn(2026, 1, days).closesOn), "2026-02-28");
  assert.equal(day(statementClosingIn(2026, 1, days).boundary), "2026-03-01");
  assert.equal(day(statementClosingIn(2028, 1, days).closesOn), "2028-02-29");
  assert.equal(day(statementClosingIn(2026, 1, days).dueOn), "2026-03-10");
});

test("due date crossing the year, and clamped in a short month", () => {
  assert.equal(day(statementClosingIn(2026, 11, C25_5).dueOn), "2027-01-05");
  // Cut-off 28, due 30: February's statement is due Feb 28 (clamped), still
  // its own month — due dates never go backwards nor collide.
  const days = { statementDay: 28, paymentDueDay: 30 };
  assert.equal(day(statementClosingIn(2026, 0, days).dueOn), "2026-01-30");
  assert.equal(day(statementClosingIn(2026, 1, days).dueOn), "2026-02-28");
  assert.equal(day(statementClosingIn(2026, 2, days).dueOn), "2026-03-30");
  // Cut-off 30, due 31 (> cut-off): in February both clamp to the 28th.
  const end = { statementDay: 30, paymentDueDay: 31 };
  assert.equal(day(statementClosingIn(2026, 1, end).closesOn), "2026-02-28");
  assert.equal(day(statementClosingIn(2026, 1, end).dueOn), "2026-02-28");
});

test("nextStatementDue: today counts; the day after the due date moves on", () => {
  assert.equal(day(nextStatementDue(D("2026-11-05"), C25_5).dueOn), "2026-11-05");
  assert.equal(day(nextStatementDue(at("2026-11-05T22:00:00Z"), C25_5).dueOn), "2026-11-05");
  assert.equal(day(nextStatementDue(D("2026-11-06"), C25_5).dueOn), "2026-12-05");
  assert.equal(day(nextStatementDue(D("2026-11-06"), C25_5).closesOn), "2026-11-25");
  assert.equal(day(nextStatementDue(D("2026-12-31"), C25_5).dueOn), "2027-01-05");
});

test("statementsDueIn: one per calendar month, and with a payday-based period", () => {
  const nov = periodBounds("2026-11", 1);
  assert.deepEqual(statementsDueIn(nov, C25_5).map(s => day(s.dueOn)), ["2026-11-05"]);
  // Payday 25: period "2026-11" is Oct 25 → Nov 25.
  const p = periodBounds("2026-11", 25);
  assert.deepEqual(statementsDueIn(p, C25_5).map(s => day(s.dueOn)), ["2026-11-05"]);
  // A due day of 31 over a February period: Feb 28.
  const feb = periodBounds("2026-02", 1);
  assert.deepEqual(statementsDueIn(feb, { statementDay: 15, paymentDueDay: 31 }).map(s => day(s.dueOn)), ["2026-02-28"]);
  // A due date on the period's end is the next period's (end is exclusive).
  const p28 = periodBounds("2026-03", 28); // Feb 28 → Mar 28
  assert.deepEqual(statementsDueIn(p28, { statementDay: 10, paymentDueDay: 28 }).map(s => day(s.dueOn)), ["2026-02-28"]);
});

test("cycleDaysOf: needs both days, a card, and not installments mode", () => {
  assert.deepEqual(cycleDaysOf(card()), C25_5);
  assert.equal(cycleDaysOf(card({ statementDay: null })), null);
  assert.equal(cycleDaysOf(card({ paymentDueDay: null })), null);
  assert.equal(cycleDaysOf(card({ statementDay: undefined })), null);
  assert.equal(cycleDaysOf(card({ paymentMode: "installments" })), null);
  assert.equal(cycleDaysOf(card({ kind: "installment" })), null);
});

// ── Lo que vence vs saldo total ────────────────────────────────────────────

test("purchases up to the cut-off are due on the due date; after it, the next one", () => {
  const l = ledger(card(), {
    purchases: [mv("a", 10000, "2026-10-10"), mv("b", 5000, "2026-10-25"), mv("c", 3000, "2026-10-26")],
  });
  const s = cardCycleSummary(l, at("2026-10-28T10:00:00Z"))!;
  assert.equal(day(s.dueOn), "2026-11-05");
  assert.equal(day(s.closesOn), "2026-10-25");
  assert.equal(s.closed, true);
  assert.equal(s.dueAmount, 15000); // the cut-off day itself is in
  assert.equal(s.afterCutAmount, 3000);
  assert.equal(day(s.afterCutDueOn), "2026-12-05");
});

test("before the cut-off, everything so far is due on the next due date (still open)", () => {
  const l = ledger(card(), { purchases: [mv("a", 10000, "2026-10-10"), mv("b", 2000, "2026-10-20")] });
  const s = cardCycleSummary(l, D("2026-10-20"))!;
  assert.equal(day(s.dueOn), "2026-11-05");
  assert.equal(s.closed, false);
  assert.equal(s.dueAmount, 12000);
  assert.equal(s.afterCutAmount, 0);
});

test("a payment after the cut-off pays the statement first, the rest stays for next month", () => {
  const l = ledger(card(), {
    purchases: [mv("a", 10000, "2026-10-10"), mv("c", 3000, "2026-10-27")],
    payments: [mv("p", 4000, "2026-10-30")],
  });
  const s = cardCycleSummary(l, D("2026-11-01"))!;
  assert.equal(s.dueAmount, 6000);
  assert.equal(s.afterCutAmount, 3000);
});

test("paying more than the statement leaves nothing due and lowers what's after the cut-off", () => {
  const l = ledger(card(), {
    purchases: [mv("a", 10000, "2026-10-10"), mv("c", 3000, "2026-10-27")],
    payments: [mv("p", 12000, "2026-11-04")],
  });
  const s = cardCycleSummary(l, D("2026-11-04"))!;
  assert.equal(s.dueAmount, 0);
  assert.equal(s.afterCutAmount, 1000);
});

test("after the due date, an unpaid remainder rolls into the next due date", () => {
  const l = ledger(card(), {
    purchases: [mv("a", 10000, "2026-10-10"), mv("c", 3000, "2026-11-02")],
    payments: [mv("p", 6000, "2026-11-05")],
  });
  const s = cardCycleSummary(l, D("2026-11-06"))!;
  assert.equal(day(s.dueOn), "2026-12-05");
  assert.equal(s.dueAmount, 7000); // 4000 left over + the November purchase
  assert.equal(s.afterCutAmount, 0);
});

test("the anchor is due on the first due date on or after the day it was set", () => {
  // Set between the cut-off and the due date: it's the closed statement.
  const between = cardCycleSummary(ledger(card({ currentBalance: 30000, balanceAsOf: at("2026-10-28T09:00:00Z") })), D("2026-10-29"))!;
  assert.equal(between.dueAmount, 30000);
  assert.equal(day(between.dueOn), "2026-11-05");
  // Set after the due date: due on the next one.
  const after = cardCycleSummary(ledger(card({ currentBalance: 30000, balanceAsOf: at("2026-11-20T09:00:00Z") })), D("2026-11-21"))!;
  assert.equal(after.dueAmount, 30000);
  assert.equal(day(after.dueOn), "2026-12-05");
});

test("an adjustment (interest) is due like pre-existing debt, from its date", () => {
  const l = ledger(card(), {
    purchases: [mv("a", 10000, "2026-10-10")],
    adjustments: [mv("int", 500, "2026-10-28"), mv("int2", 700, "2026-11-10")],
  });
  const s = cardCycleSummary(l, D("2026-10-30"))!;
  assert.equal(s.dueAmount, 10500);
  assert.equal(s.afterCutAmount, 700);
});

test("a refund after the cut-off can't make the due amount exceed the balance", () => {
  const l = ledger(card(), {
    purchases: [mv("a", 10000, "2026-10-10"), mv("refund", -4000, "2026-10-27")],
  });
  const s = cardCycleSummary(l, D("2026-10-28"))!;
  assert.equal(s.dueAmount, 6000);
  assert.equal(s.afterCutAmount, 0);
});

test("overpaid card: nothing due, nothing after", () => {
  const l = ledger(card(), { purchases: [mv("a", 1000, "2026-10-10")], payments: [mv("p", 5000, "2026-10-12")] });
  const s = cardCycleSummary(l, D("2026-10-13"))!;
  assert.equal(s.dueAmount, 0);
  assert.equal(s.afterCutAmount, 0);
});

test("no cycle: no summary (callers keep today's behaviour)", () => {
  assert.equal(cardCycleSummary(ledger(card({ statementDay: null }))), null);
  assert.equal(cycleCommitments(ledger(card({ paymentDueDay: null })), periods("2026-11", 3)), null);
});

test("leap year: a cut-off on the 29th of February 2028 holds the purchase of that day", () => {
  const l = ledger(card({ statementDay: 31, paymentDueDay: 10, balanceAsOf: D("2028-01-01") }), {
    purchases: [mv("leap", 2000, "2028-02-29"), mv("march", 1000, "2028-03-01")],
  });
  const s = cardCycleSummary(l, D("2028-03-02"))!;
  assert.equal(day(s.closesOn), "2028-02-29");
  assert.equal(day(s.dueOn), "2028-03-10");
  assert.equal(s.dueAmount, 2000);
  assert.equal(s.afterCutAmount, 1000);
  assert.equal(day(s.afterCutDueOn), "2028-04-10");
});

// ── Committed future ───────────────────────────────────────────────────────

test("full card: each period commits what falls due in it", () => {
  const l = ledger(card(), {
    purchases: [mv("oct", 50000, "2026-10-10"), mv("after", 20000, "2026-10-28"), mv("nov", 10000, "2026-11-03")],
  });
  // November (calendar periods): Nov 5 due → October's statement (500).
  // December: Dec 5 → purchases Oct 26–Nov 25 so far (300). Then nothing.
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 4)), [50000, 30000, 0, 0]);
});

test("full card: paying during the current period doesn't shrink it, and doesn't shift the next", () => {
  const l = ledger(card(), {
    purchases: [mv("oct", 50000, "2026-10-10"), mv("after", 20000, "2026-10-28")],
    payments: [mv("p", 50000, "2026-11-05")],
  });
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 3)), [50000, 20000, 0]);
});

test("full card: paying ahead lowers the next period", () => {
  const l = ledger(card(), {
    purchases: [mv("oct", 50000, "2026-10-10"), mv("after", 20000, "2026-10-28")],
    payments: [mv("p", 65000, "2026-11-05")],
  });
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 2)), [50000, 5000]);
});

test("full card: payments before the period start reduce it", () => {
  const l = ledger(card(), {
    purchases: [mv("oct", 50000, "2026-10-10")],
    payments: [mv("early", 30000, "2026-10-30")],
  });
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 2)), [20000, 0]);
});

test("full card: after this period's due date, the next statement is next period's", () => {
  // Today Nov 20: Nov 5 was paid in full; purchases since the Oct 25 cut-off
  // are due Dec 5, i.e. in December, not November.
  const l = ledger(card(), {
    purchases: [mv("oct", 50000, "2026-10-10"), mv("nov", 12000, "2026-11-12")],
    payments: [mv("p", 50000, "2026-11-04")],
  });
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 2)), [50000, 12000]);
});

test("full card with an unpaid overdue statement commits it in the current period", () => {
  const l = ledger(card(), { purchases: [mv("sep", 40000, "2026-09-10")] }); // due Oct 5, never paid
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 2)), [40000, 0]);
});

test("minimum card: the minimum at each due date, capped by what's still owed", () => {
  const l = ledger(card({ paymentMode: "minimum", minimumPayment: 10000, currentBalance: 25000 }), {});
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 4)), [10000, 10000, 5000, 0]);
});

test("minimum card: a statement smaller than the minimum commits only the statement", () => {
  const l = ledger(card({ paymentMode: "minimum", minimumPayment: 10000 }), { purchases: [mv("a", 4000, "2026-10-10")] });
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 2)), [4000, 0]);
});

test("payday-based periods: due dates are bucketed by the user's cycleStartDay", () => {
  // Payday 10: "2026-11" = Oct 10 → Nov 10 (holds Nov 5), "2026-12" = Nov 10 → Dec 10 (Dec 5).
  const l = ledger(card(), { purchases: [mv("oct", 50000, "2026-10-12"), mv("after", 20000, "2026-10-28")] });
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 3, 10)), [50000, 20000, 0]);
  // Payday 6: "2026-11" = Oct 6 → Nov 6 still holds Nov 5.
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 2, 6)), [50000, 20000]);
  // Payday 5: Nov 5 opens "2026-12" (Nov 5 → Dec 5); "2026-11" holds Oct 5.
  assert.deepEqual(cycleCommitments(l, periods("2026-11", 3, 5)), [0, 50000, 20000]);
});

test("buildDebtTimeline uses the cycle amounts when given, the payment mode otherwise", () => {
  const base = {
    id: "visa", name: "Visa", kind: "credit_card", status: "active", paymentMode: "full",
    minimumPayment: null, installmentAmount: null, installmentsTotal: null, installmentsPaid: null, previousRemaining: 9999,
  };
  const now = D("2026-11-20");
  const withCycle = buildDebtTimeline([{ ...base, cycleAmounts: [50000, 30000, 0] }], 200000, 1, 3, now);
  assert.deepEqual(withCycle.map(p => p.committed), [50000, 30000, 0]);
  assert.deepEqual(withCycle.map(p => p.period), ["2026-11", "2026-12", "2027-01"]);
  assert.equal(withCycle[1].pctCommitted, 15);
  const without = buildDebtTimeline([base], 200000, 1, 3, now);
  assert.deepEqual(without.map(p => p.committed), [9999, 0, 0]);
});
