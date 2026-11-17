import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectCelebrations, unseen, payYourselfStreak, freedMonthly, parseMilestones, isCelebrationKey,
  type CelebrationFacts, type PlanFacts, type DebtFacts, type PayYourselfMonth,
} from "./celebrations.js";

const plan = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  id: "p1", title: "Vacaciones", type: "travel", goalClass: "savings",
  targetAmount: 100_000, currentAmount: 0, milestones: "[]", contributed: false, ...over,
});
const debt = (over: Partial<DebtFacts> = {}): DebtFacts => ({
  id: "d1", name: "Coche", kind: "auto_loan", status: "paid_off", paymentMode: "installments",
  installmentAmount: 25_050, minimumPayment: null, ...over,
});
const facts = (over: Partial<CelebrationFacts> = {}): CelebrationFacts => ({
  plans: [], debts: [], payYourselfFirst: [], lastClosedMonth: null, ...over,
});
const keys = (f: CelebrationFacts) => detectCelebrations(f).map(c => c.key);
const months = (...met: boolean[]): PayYourselfMonth[] =>
  // newest first; the first is the open month
  met.map((m, i) => ({ month: `2026-${String(11 - i).padStart(2, "0")}`, closed: i > 0, met: m }));

describe("celebrations: debts", () => {
  it("a paid-off debt frees its instalment, in cents", () => {
    const [c] = detectCelebrations(facts({ debts: [debt()] }));
    assert.deepEqual(c, { key: "debt-paid:d1", kind: "debtPaidOff", name: "Coche", amount: 25_050 });
  });

  it("what is freed follows the payment mode; unknown or varying → no amount", () => {
    assert.equal(freedMonthly(debt({ paymentMode: "minimum", minimumPayment: 4_000, installmentAmount: 9_000 })), 4_000);
    assert.equal(freedMonthly(debt({ paymentMode: "minimum", minimumPayment: null, installmentAmount: 9_000 })), 9_000);
    assert.equal(freedMonthly(debt({ paymentMode: "full", installmentAmount: 9_000 })), null);
    assert.equal(freedMonthly(debt({ paymentMode: "installments", installmentAmount: 0 })), null);
  });

  it("an active debt or a card is never celebrated", () => {
    assert.deepEqual(keys(facts({ debts: [debt({ status: "active" }), debt({ id: "c", kind: "credit_card" })] })), []);
  });
});

describe("celebrations: plans", () => {
  it("first contribution, then the highest 25/50/75 % marker reached, compared in integer cents", () => {
    assert.deepEqual(keys(facts({ plans: [plan({ contributed: true, currentAmount: 24_999 })] })), ["plan-first:p1"]);
    assert.deepEqual(keys(facts({ plans: [plan({ contributed: true, currentAmount: 25_000 })] })), ["plan-milestone:p1:pct25"]);
    assert.deepEqual(keys(facts({ plans: [plan({ currentAmount: 80_000 })] })), ["plan-milestone:p1:pct75"]);
    // A target that doesn't divide evenly: 33.333 € is 25 % of 133.33 €.
    assert.deepEqual(keys(facts({ plans: [plan({ targetAmount: 13_333, currentAmount: 3_333 })] })), []);
    assert.deepEqual(keys(facts({ plans: [plan({ targetAmount: 13_333, currentAmount: 3_334 })] })), ["plan-milestone:p1:pct25"]);
  });

  it("a plan without contributions has nothing to celebrate", () => {
    assert.deepEqual(keys(facts({ plans: [plan()] })), []);
  });

  it("done supersedes milestones and the first contribution; the emergency fund is its own", () => {
    assert.deepEqual(keys(facts({ plans: [plan({ contributed: true, currentAmount: 100_000 })] })), ["plan-done:p1"]);
    const [c] = detectCelebrations(facts({ plans: [plan({ type: "emergency", currentAmount: 100_001 })] }));
    assert.deepEqual(c, { key: "emergency-done:p1", kind: "emergencyFundDone", title: "Vacaciones" });
  });

  it("investment milestones are saved in euros: compared in cents, only the highest reached", () => {
    assert.deepEqual(parseMilestones("[50, 100.5, \"x\", -1]"), [5_000, 10_050]);
    assert.deepEqual(parseMilestones("not json"), []);
    const inv = (currentAmount: number) => plan({ goalClass: "investment", targetAmount: 0, milestones: "[50, 100.5]", currentAmount });
    assert.deepEqual(keys(facts({ plans: [inv(4_999)] })), []);
    assert.deepEqual(keys(facts({ plans: [inv(5_000)] })), ["plan-milestone:p1:5000"]);
    const [c] = detectCelebrations(facts({ plans: [inv(20_000)] }));
    assert.deepEqual(c, { key: "plan-milestone:p1:10050", kind: "planMilestone", title: "Vacaciones", pct: null, amount: 10_050 });
  });
});

describe("celebrations: Págate a ti primero", () => {
  it("an open month not met yet doesn't break the streak; a closed one does", () => {
    assert.deepEqual(payYourselfStreak(months(false, true, true, false, true)), { length: 2, start: "2026-09" });
    assert.deepEqual(payYourselfStreak(months(true, true, true)), { length: 3, start: "2026-09" });
    assert.deepEqual(payYourselfStreak(months(false, false)), { length: 0, start: null });
    assert.deepEqual(payYourselfStreak([]), { length: 0, start: null });
  });

  it("the first month met, and the longest streak threshold reached, keyed by its start", () => {
    assert.deepEqual(keys(facts({ payYourselfFirst: months(true) })), ["pyf-first"]);
    assert.deepEqual(keys(facts({ payYourselfFirst: months(false, true, true) })), ["pyf-first"]);
    assert.deepEqual(keys(facts({ payYourselfFirst: months(true, true, true, false) })), ["pyf-streak:2026-09:3", "pyf-first"]);
    const six = months(true, true, true, true, true, true, true);
    assert.deepEqual(keys(facts({ payYourselfFirst: six })), ["pyf-streak:2026-05:6", "pyf-first"]);
  });

  it("nothing is said when it isn't met", () => {
    assert.deepEqual(keys(facts({ payYourselfFirst: months(false, false) })), []);
  });
});

describe("celebrations: month within budget", () => {
  const closed = (budgeted: number, spent: number) => facts({ lastClosedMonth: { month: "2026-10", budgeted, spent } });
  it("spent up to the cent of the budget", () => {
    assert.deepEqual(keys(closed(200_000, 200_000)), ["budget-month:2026-10"]);
    assert.deepEqual(keys(closed(200_000, 200_001)), []);
  });
  it("a month with nothing budgeted or nothing spent proves nothing", () => {
    assert.deepEqual(keys(closed(0, 0)), []);
    assert.deepEqual(keys(closed(200_000, 0)), []);
  });
});

describe("celebrations: order and once only", () => {
  const all = facts({
    plans: [plan({ id: "a", contributed: true, currentAmount: 1 }), plan({ id: "b", currentAmount: 100_000 })],
    debts: [debt()],
    payYourselfFirst: months(true),
    lastClosedMonth: { month: "2026-10", budgeted: 10, spent: 5 },
  });

  it("biggest first", () => {
    assert.deepEqual(keys(all), ["debt-paid:d1", "plan-done:b", "budget-month:2026-10", "pyf-first", "plan-first:a"]);
  });

  it("a seen key never comes back; the rest keep their order", () => {
    const left = unseen(detectCelebrations(all), ["debt-paid:d1", "pyf-first"]).map(c => c.key);
    assert.deepEqual(left, ["plan-done:b", "budget-month:2026-10", "plan-first:a"]);
  });

  it("every key it makes is one the client may send back as seen", () => {
    const more = facts({ plans: [plan({ goalClass: "investment", targetAmount: 0, milestones: "[50]", currentAmount: 9_999 })], payYourselfFirst: months(true, true, true, true) });
    for (const k of [...keys(all), ...keys(more)]) assert.ok(isCelebrationKey(k), k);
  });

  it("refuses junk keys", () => {
    for (const k of ["", "DEBT:x", "debt-paid:x y", "a:b:c:d:e", `x:${"a".repeat(65)}`, 3, null]) {
      assert.equal(isCelebrationKey(k), false, String(k));
    }
  });
});
