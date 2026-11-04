// A credit card's billing cycle (LPBETA-01, docs/plan-deudas-y-onboarding.md §1.9).
//
// With `statementDay` (the statement closes) and `paymentDueDay` (that
// statement must be paid), a card's balance splits in two time axes:
//   - "lo que vence": what the next due date asks for — purchases up to the
//     cut-off, plus anything older still unpaid;
//   - "saldo total": everything owed, including purchases after the cut-off,
//     which are due on the FOLLOWING due date.
// Derived, never stored: statements are computed from movement dates at query
// time, like the budget period (server/lib/period.ts) and the balance itself
// (server/lib/debtBalance.ts). All dates are UTC days, as everywhere else.
//
// Rules (also in the LPBETA-01 report):
//  1. Dates. The statement closing in month M closes on `statementDay` of M,
//     clamped to M's last day (31 → 28/29 in February). A purchase dated ON
//     the cut-off day is in that statement. That statement is due on
//     `paymentDueDay` of M when paymentDueDay > statementDay, else of M+1
//     (decided on the raw days, then clamped, so each month's statement keeps
//     a fixed due month and due dates never go backwards).
//  2. What enters each statement. Card purchases (refunds negative) by their
//     date. The pre-existing debt — the anchor at `balanceAsOf` and dated
//     adjustments (interest, corrections) — has no purchase date to place it
//     by, so it's due on the FIRST due date on or after the day it was
//     recorded ("I owe 300 now" typed after the cut-off and before the due
//     date is, almost always, that statement).
//  3. Payments go to the oldest unpaid statement first: a statement's amount
//     due is everything charged up to it minus every payment so far, never
//     below zero nor above the live balance.
//  4. Missing statementDay or paymentDueDay, or a card in "installments"
//     mode: no cycle — every caller falls back to today's behaviour.
import type { DebtLedger } from "./debtBalance.js";

const DAY_MS = 86_400_000;
const utc = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
/** Midnight UTC of the day `date` falls on. */
const dayOf = (date: Date) => utc(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
/** Day `day` of a month, clamped to the month's length. `m0` may overflow
 *  (−1, 12…): Date.UTC normalizes it into the neighbouring year. */
export function clampedDay(y: number, m0: number, day: number): Date {
  const first = utc(y, m0, 1);
  const yy = first.getUTCFullYear();
  const mm = first.getUTCMonth();
  return utc(yy, mm, Math.min(Math.max(1, day), daysInMonth(yy, mm)));
}

export interface CardCycleDays { statementDay: number; paymentDueDay: number }

export interface Statement {
  closesOn: Date; // the cut-off day (midnight UTC); purchases on it are in
  boundary: Date; // closesOn + 1 day: purchases dated before it are in
  dueOn: Date;    // when this statement must be paid (midnight UTC)
}

/** The statement closing in month (y, m0). */
export function statementClosingIn(y: number, m0: number, days: CardCycleDays): Statement {
  const closesOn = clampedDay(y, m0, days.statementDay);
  const dueMonth = days.paymentDueDay > days.statementDay ? m0 : m0 + 1;
  return {
    closesOn,
    boundary: new Date(closesOn.getTime() + DAY_MS),
    dueOn: clampedDay(y, dueMonth, days.paymentDueDay),
  };
}

/** The first statement due on or after `date`'s day. */
export function nextStatementDue(date: Date, days: CardCycleDays): Statement {
  const today = dayOf(date);
  // The statement due in or after today's month closed at most a month before.
  for (let i = -2; i <= 2; i++) {
    const s = statementClosingIn(date.getUTCFullYear(), date.getUTCMonth() + i, days);
    if (s.dueOn >= today) return s;
  }
  throw new Error("unreachable: a statement is due every month");
}

/** Statements whose due date falls in [start, end), oldest first. */
export function statementsDueIn(period: { start: Date; end: Date }, days: CardCycleDays): Statement[] {
  const out: Statement[] = [];
  let s = nextStatementDue(period.start, days);
  while (s.dueOn < period.end) {
    out.push(s);
    s = statementClosingIn(s.closesOn.getUTCFullYear(), s.closesOn.getUTCMonth() + 1, days);
  }
  return out;
}

/** The card's cycle days, or null when it has no usable cycle (rule 4). */
export function cycleDaysOf(debt: DebtLedger["debt"]): CardCycleDays | null {
  if (debt.kind !== "credit_card" || debt.paymentMode === "installments") return null;
  if (debt.statementDay == null || debt.paymentDueDay == null) return null;
  return { statementDay: debt.statementDay, paymentDueDay: debt.paymentDueDay };
}

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

/** Everything charged to the card that is due by statement `s` (rule 2),
 *  cumulative: older statements included. Without a `balanceAsOf` (a ledger
 *  built by hand) the anchor counts as already due. */
function chargedBy(ledger: DebtLedger, s: Statement): number {
  const asOf = ledger.debt.balanceAsOf;
  const anchor = !asOf || dayOf(asOf) <= s.dueOn ? ledger.debt.currentBalance : 0;
  return anchor
    + sum(ledger.purchases.filter(p => p.date < s.boundary))
    + sum(ledger.adjustments.filter(a => dayOf(a.date) <= s.dueOn));
}

const live = (ledger: DebtLedger) =>
  ledger.debt.currentBalance + sum(ledger.purchases) + sum(ledger.adjustments) - sum(ledger.payments);

export interface CardCycleSummary {
  dueOn: Date;            // the next due date (today included)
  closesOn: Date;         // its statement's cut-off
  closed: boolean;        // false: the cut-off hasn't come yet, the amount can still grow
  dueAmount: number;      // cents — what that due date asks for ("lo que vence")
  afterCutAmount: number; // cents — the rest of the balance, due later
  afterCutDueOn: Date;    // when that rest is due (the following due date)
}

/** "Lo que vence" vs "saldo total" for a card with a cycle, as of `now`.
 *  null without one (rule 4). The two amounts always add up to the live
 *  balance (floored at zero). */
export function cardCycleSummary(ledger: DebtLedger, now: Date = new Date()): CardCycleSummary | null {
  const days = cycleDaysOf(ledger.debt);
  if (!days) return null;
  const owed = Math.max(0, live(ledger));
  const next = nextStatementDue(now, days);
  const following = statementClosingIn(next.closesOn.getUTCFullYear(), next.closesOn.getUTCMonth() + 1, days);
  const dueAmount = Math.min(owed, Math.max(0, chargedBy(ledger, next) - sum(ledger.payments)));
  return {
    dueOn: next.dueOn,
    closesOn: next.closesOn,
    closed: next.boundary <= dayOf(now),
    dueAmount,
    afterCutAmount: owed - dueAmount,
    afterCutDueOn: following.dueOn,
  };
}

/** What a card with a cycle commits in each period of the committed-future
 *  timeline (`periods[0]` is the current one), or null without a cycle.
 *
 *  Each due date commits its statement to the period it falls in:
 *   - "full": the whole statement (purchases up to the cut-off, plus any
 *     pre-existing debt or older unpaid remainder). Purchases after the
 *     cut-off move to the next period: that's money of next month's income
 *     already spoken for. Only movements recorded so far count, so periods
 *     past the next statement usually commit 0.
 *   - "minimum": `minimumPayment` at each due date, never more than what's
 *     still owed after the earlier commitments (the balance carries over).
 *  Like the budget line, the current period is measured at its START:
 *  payments made during it don't shrink what it commits (they're paying it).
 *  Commitments of earlier due dates count as paid when measuring later ones,
 *  unless the payments recorded are already larger. */
export function cycleCommitments(
  ledger: DebtLedger,
  periods: { start: Date; end: Date }[],
): number[] | null {
  const days = cycleDaysOf(ledger.debt);
  if (!days || periods.length === 0) return null;
  const minimum = ledger.debt.minimumPayment ?? ledger.debt.installmentAmount ?? 0;
  const paidBeforeStart = sum(ledger.payments.filter(p => p.date < periods[0].start));
  const paidAll = sum(ledger.payments);

  let committed = 0;
  return periods.map((period, i) => {
    let inPeriod = 0;
    for (const s of statementsDueIn(period, days)) {
      const covered = Math.max(i === 0 ? paidBeforeStart : paidAll, paidBeforeStart + committed);
      const outstanding = Math.max(0, chargedBy(ledger, s) - covered);
      const amount = ledger.debt.paymentMode === "minimum" ? Math.min(minimum, outstanding) : outstanding;
      committed += amount;
      inPeriod += amount;
    }
    return inPeriod;
  });
}

/** "YYYY-MM-DD" of a UTC day, for the API. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
