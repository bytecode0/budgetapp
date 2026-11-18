import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectCelebrations, unseen, payYourselfStreak, freedMonthly, parseMilestones, isCelebrationKey, planReached, keysSeenWith, baselineKeys,
  PYF_WINDOW, type CelebrationFacts, type PlanFacts, type DebtFacts, type PayYourselfFacts,
} from "./celebrations.js";
import { periodKeyOffset } from "./period.js";

const plan = (over: Partial<PlanFacts> = {}): PlanFacts => ({
  id: "p1", title: "Vacaciones", type: "travel", goalClass: "savings",
  targetAmount: 100_000, currentAmount: 0, milestones: "[]", contributed: false, ...over,
});
const debt = (over: Partial<DebtFacts> = {}): DebtFacts => ({
  id: "d1", name: "Coche", kind: "auto_loan", status: "paid_off", paymentMode: "installments",
  installmentAmount: 25_050, minimumPayment: null, ...over,
});
const facts = (over: Partial<CelebrationFacts> = {}): CelebrationFacts => ({
  plans: [], debts: [], payYourselfFirst: { openMet: false, closed: [] }, lastClosedMonth: null, ...over,
});
const keys = (f: CelebrationFacts) => detectCelebrations(f).map(c => c.key);
/** The open month (2026-11) and closed months newest first (2026-10, 09…),
 *  padded with unmet months up to the window, as the loader reads them. */
const pyf = (openMet: boolean, ...closedMet: boolean[]): PayYourselfFacts => ({
  openMet,
  closed: Array.from({ length: PYF_WINDOW }, (_, i) => ({ month: periodKeyOffset("2026-11", -1 - i), met: closedMet[i] ?? false })),
});

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

describe("celebrations: a balance typed by hand", () => {
  it("planReached lists every level the balance reaches, not just the highest", () => {
    assert.deepEqual(planReached(plan({ currentAmount: 60_000 })).map(c => c.key), ["plan-milestone:p1:pct50", "plan-milestone:p1:pct25"]);
    assert.deepEqual(planReached(plan({ currentAmount: 100_000 })).map(c => c.key),
      ["plan-done:p1", "plan-milestone:p1:pct75", "plan-milestone:p1:pct50", "plan-milestone:p1:pct25"]);
    assert.deepEqual(planReached(plan({ goalClass: "investment", targetAmount: 0, milestones: "[50, 100]", currentAmount: 20_000 })).map(c => c.key),
      ["plan-milestone:p1:10000", "plan-milestone:p1:5000"]);
    assert.deepEqual(planReached(plan({ currentAmount: 24_999 })), []);
  });
});

describe("celebrations: Págate a ti primero", () => {
  it("a streak counts closed months only, from the last closed one back", () => {
    assert.deepEqual(payYourselfStreak(pyf(true, true, true, false, true).closed), { length: 2, start: "2026-09", known: true });
    assert.deepEqual(payYourselfStreak(pyf(true, false, true).closed), { length: 0, start: null, known: true });
    assert.deepEqual(payYourselfStreak([]), { length: 0, start: null, known: true });
  });

  it("the first month met (the open one counts for this), never a streak from the open month", () => {
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(true) })), ["pyf-first"]);
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(false, true) })), ["pyf-first"]);
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(true, true, true) })), ["pyf-first"], "2 closed + the open one is not 3");
  });

  it("the longest threshold reached, keyed by the month it was reached in", () => {
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(false, true, true, true, false) })), ["pyf-streak:2026-10:3", "pyf-first"]);
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(false, true, true, true, true) })), ["pyf-streak:2026-09:3", "pyf-first"]);
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(false, ...Array(7).fill(true)) })), ["pyf-streak:2026-09:6", "pyf-first"]);
  });

  it("a long streak, month after month: each threshold has ONE key, never re-fired; a full window says nothing more", () => {
    // Every month met from 2025-01 on; read at the end of each month for 4 years.
    const start = "2025-01";
    const closedAt = (lastClosed: string) => Array.from({ length: PYF_WINDOW }, (_, j) => {
      const month = periodKeyOffset(lastClosed, -j);
      return { month, met: month >= start };
    });
    const streakKeys = (lastClosed: string) =>
      keys(facts({ payYourselfFirst: { openMet: false, closed: closedAt(lastClosed) } })).filter(k => k.startsWith("pyf-streak"));

    const seen = new Set<string>();
    const shown: string[] = [];
    for (let i = 0; i < 48; i++) {
      for (const k of streakKeys(periodKeyOffset(start, i))) if (!seen.has(k)) { shown.push(k); seen.add(k); }
    }
    assert.deepEqual(shown, ["pyf-streak:2025-03:3", "pyf-streak:2025-06:6", "pyf-streak:2025-12:12"]);

    // Even without the seen marks, months 12 to 23 of the streak give the same key…
    const twelve = new Set(Array.from({ length: 12 }, (_, i) => streakKeys(periodKeyOffset(start, 11 + i))).flat());
    assert.deepEqual([...twelve], ["pyf-streak:2025-12:12"]);
    // …and once the streak fills the window there is nothing more to say.
    assert.deepEqual(streakKeys(periodKeyOffset(start, PYF_WINDOW - 1)), []);
  });

  it("nothing is said when it isn't met", () => {
    assert.deepEqual(keys(facts({ payYourselfFirst: pyf(false, false, false) })), []);
  });
});

describe("celebrations: month within budget", () => {
  const closed = (budgeted: number, spent: number, unassigned = 0) => facts({ lastClosedMonth: { month: "2026-10", budgeted, spent, unassigned } });
  it("spent up to the cent of the budget", () => {
    assert.deepEqual(keys(closed(200_000, 200_000)), ["budget-month:2026-10"]);
    assert.deepEqual(keys(closed(200_000, 200_001)), []);
  });
  it("not claimed while some spending is uncategorised", () => {
    assert.deepEqual(keys(closed(200_000, 100_000, 1)), []);
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
    payYourselfFirst: pyf(true),
    lastClosedMonth: { month: "2026-10", budgeted: 10, spent: 5, unassigned: 0 },
  });

  it("biggest first", () => {
    assert.deepEqual(keys(all), ["debt-paid:d1", "plan-done:b", "budget-month:2026-10", "pyf-first", "plan-first:a"]);
  });

  it("a seen key never comes back; the rest keep their order", () => {
    const left = unseen(detectCelebrations(all), ["debt-paid:d1", "pyf-first"]).map(c => c.key);
    assert.deepEqual(left, ["plan-done:b", "budget-month:2026-10", "plan-first:a"]);
  });

  it("every key it makes is one the client may send back as seen", () => {
    const more = facts({ plans: [plan({ goalClass: "investment", targetAmount: 0, milestones: "[50]", currentAmount: 9_999 })], payYourselfFirst: pyf(false, true, true, true) });
    for (const k of [...keys(all), ...keys(more)]) assert.ok(isCelebrationKey(k), k);
  });

  it("refuses junk keys", () => {
    for (const k of ["", "DEBT:x", "debt-paid:x y", "a:b:c:d:e", `x:${"a".repeat(65)}`, 3, null]) {
      assert.equal(isCelebrationKey(k), false, String(k));
    }
  });
});

describe("celebrations: a plan whose balance drops later", () => {
  const atDone = facts({ plans: [plan({ type: "emergency", contributed: true, currentAmount: 100_000 })] });
  const dropped = (currentAmount: number) => facts({ plans: [plan({ type: "emergency", contributed: true, currentAmount })] });

  it("seeing the biggest closes every level of the plan and its first contribution", () => {
    assert.deepEqual(keysSeenWith(atDone, "emergency-done:p1").sort(), [
      "emergency-done:p1", "plan-first:p1", "plan-milestone:p1:pct25", "plan-milestone:p1:pct50", "plan-milestone:p1:pct75",
    ]);
    assert.deepEqual(keysSeenWith(atDone, "pyf-first"), ["pyf-first"], "not a plan key: only itself");
  });

  it("the fund used afterwards offers nothing: no '75 %', no 'first contribution'", () => {
    const marked = keysSeenWith(atDone, "emergency-done:p1");
    for (const amount of [80_000, 55_000, 30_000, 10]) {
      assert.deepEqual(unseen(detectCelebrations(dropped(amount)), marked), [], String(amount));
    }
    // Climbing back to the target is not new either.
    assert.deepEqual(unseen(detectCelebrations(atDone), marked), []);
  });

  it("the baseline marks every level each plan reaches, so a later drop offers nothing", () => {
    const base = baselineKeys(atDone);
    assert.equal(base[0], "baseline");
    for (const amount of [80_000, 30_000, 1]) assert.deepEqual(unseen(detectCelebrations(dropped(amount)), base), [], String(amount));
  });

  it("the baseline doesn't mark a first contribution that hasn't happened", () => {
    const base = baselineKeys(facts({ plans: [plan()] }));
    assert.deepEqual(base, ["baseline"]);
    assert.deepEqual(unseen(detectCelebrations(facts({ plans: [plan({ contributed: true })] })), base).map(c => c.key), ["plan-first:p1"]);
  });
});

describe("celebrations: a streak shifted by an edited old month", () => {
  const streak = (key: string, months: number) => ({ key, kind: "payYourselfFirstStreak" as const, months });

  it("the same n reached within n months of one already seen is not offered again", () => {
    const seen = ["pyf-streak:2026-05:6"];
    assert.deepEqual(unseen([streak("pyf-streak:2026-04:6", 6)], seen), []);
    assert.deepEqual(unseen([streak("pyf-streak:2026-08:6", 6)], seen), []);
    assert.deepEqual(unseen([streak("pyf-streak:2026-11:6", 6)], seen), [], "6 months later: still the same streak");
  });

  it("a genuinely new streak (after a missed month) is offered", () => {
    assert.equal(unseen([streak("pyf-streak:2026-12:6", 6)], ["pyf-streak:2026-05:6"]).length, 1);
    assert.equal(unseen([streak("pyf-streak:2026-06:3", 3)], ["pyf-streak:2026-05:6"]).length, 1, "another length is its own");
  });

  it("end to end: moving the streak's start by editing an old month says nothing new", () => {
    const run = (startMonth: string, lastClosed: string) => facts({ payYourselfFirst: {
      openMet: false,
      closed: Array.from({ length: PYF_WINDOW }, (_, j) => {
        const month = periodKeyOffset(lastClosed, -j);
        return { month, met: month >= startMonth };
      }),
    } });
    const seen = detectCelebrations(run("2026-01", "2026-08")).map(c => c.key); // streak of 8 → 6, reached 2026-06
    assert.ok(seen.includes("pyf-streak:2026-06:6"));
    // An old month edited so it now counts too: the 6 is "reached" a month earlier.
    assert.deepEqual(unseen(detectCelebrations(run("2025-12", "2026-08")), seen), []);
  });
});
