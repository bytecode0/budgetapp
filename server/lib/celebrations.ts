// "Celebrar los hitos" (LPBETA-13): the moments worth a short "lo has
// conseguido" on Home. Derived from the data on every read, never stored as
// events; the only thing stored is which ones a person has already seen
// (CelebrationSeen, per real person), so each shows once on any device.
//
// What is celebrated, each with a stable key (the "seen" mark is by key):
//   debt-paid:<debtId>              a debt marked paid off: "Has cerrado X. Liberas N € al mes"
//   emergency-done:<planId>         an emergency-fund plan reached its target
//   plan-done:<planId>              any other plan reached its target
//   plan-milestone:<planId>:<m>     a plan milestone reached: m = pct25|pct50|pct75 of a
//                                   savings plan's target, or the milestone in cents of an
//                                   investment plan (LifePlan.milestones)
//   plan-first:<planId>             the plan's first contribution
//   pyf-first                       the first month meeting "Págate a ti primero"
//   pyf-streak:<start>:<n>          n = 3, 6 or 12 months in a row meeting it, from <start>
//   budget-month:<YYYY-MM>          the last closed month ended within its budget
//
// Per plan only the biggest is offered (done > milestone > first contribution),
// and only its highest milestone reached: a plan finished before this existed
// gets one card, not five.
//
// Household: plans, the budget and "Págate a ti primero" belong to the shared
// pool, so both members see those. A debt follows its visibility: a private
// one celebrates only for its owner (visibleToWhere, server/lib/ownership.ts).
//
// Never judges: nothing is said when a month is missed. Integer cents.
import { prisma } from "./prisma.js";
import { visibleToWhere } from "./ownership.js";
import { currentPeriodKey, periodBounds, periodEnded, periodKeyOffset } from "./period.js";
import { getCycleStartDay } from "./getCycleStartDay.js";
import { monthSavings } from "./payYourselfFirst.js";
import { monthReview } from "./monthReview.js";
import { bookedByPlan } from "./planLedger.js";
import { toCents } from "./money.js";

export type Celebration =
  | { key: string; kind: "debtPaidOff"; name: string; amount: number | null } // amount: cents a month freed
  | { key: string; kind: "emergencyFundDone"; title: string }
  | { key: string; kind: "planDone"; title: string }
  | { key: string; kind: "planMilestone"; title: string; pct: number | null; amount: number | null } // pct of target, or cents
  | { key: string; kind: "planFirstContribution"; title: string }
  | { key: string; kind: "payYourselfFirstFirst" }
  | { key: string; kind: "payYourselfFirstStreak"; months: number }
  | { key: string; kind: "monthWithinBudget"; month: string };

export type CelebrationKind = Celebration["kind"];

/** The order they are shown in, one at a time: the biggest first. */
const ORDER: CelebrationKind[] = [
  "debtPaidOff", "emergencyFundDone", "planDone", "payYourselfFirstStreak",
  "monthWithinBudget", "planMilestone", "payYourselfFirstFirst", "planFirstContribution",
];

/** Streak lengths celebrated, longest first. */
export const STREAKS = [12, 6, 3] as const;

/** Savings plans: the same 25/50/75 % markers PlanDetail shows (100 % is "done"). */
const SAVINGS_MILESTONE_PCTS = [75, 50, 25] as const;

/** A key the client may send back as seen: lowercase name, then ":"-separated
 *  ids/labels. Bounded so the table can't be filled with junk. */
const KEY_RE = /^[a-z]+(-[a-z]+)*(:[A-Za-z0-9_-]{1,64}){0,3}$/;
export function isCelebrationKey(v: unknown): v is string {
  return typeof v === "string" && v.length <= 160 && KEY_RE.test(v);
}

// ── Pure detection ─────────────────────────────────────────────────────────

export interface PlanFacts {
  id: string;
  title: string;
  type: string;           // "emergency" marks the emergency fund
  goalClass: string;      // "savings" | "investment" (or legacy "wealth")
  targetAmount: number;   // cents
  currentAmount: number;  // cents
  milestones: string;     // JSON array of milestone amounts in EUROS, as PlanDetail saves them
  contributed: boolean;   // any positive contribution ever (deposit or plan-line expense)
}

export interface DebtFacts {
  id: string;
  name: string;
  kind: string;
  status: string;
  paymentMode: string;
  installmentAmount: number | null;
  minimumPayment: number | null;
}

/** One month of "Págate a ti primero": newest first, the open month first. */
export interface PayYourselfMonth { month: string; closed: boolean; met: boolean }

export interface CelebrationFacts {
  plans: PlanFacts[];
  debts: DebtFacts[];          // only those the viewer may see
  payYourselfFirst: PayYourselfMonth[];
  /** The last closed month's budget, or null when there is none to judge. */
  lastClosedMonth: { month: string; budgeted: number; spent: number } | null; // cents
}

/** Milestones of an investment plan, in cents, from the euros JSON. Bad data → none. */
export function parseMilestones(json: string): number[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((m): m is number => typeof m === "number" && Number.isFinite(m) && m > 0).map(m => toCents(m));
  } catch {
    return [];
  }
}

/** What a paid-off debt no longer takes each month (cents), as its budget
 *  line held it (debtBalance.ts monthlyCommitment); null when it varied
 *  ("full" mode) or was never known. */
export function freedMonthly(d: DebtFacts): number | null {
  const amount = d.paymentMode === "full" ? null
    : d.paymentMode === "installments" ? d.installmentAmount
    : d.minimumPayment ?? d.installmentAmount;
  return amount && amount > 0 ? amount : null;
}

function planCelebration(p: PlanFacts): Celebration | null {
  if (p.targetAmount > 0 && p.currentAmount >= p.targetAmount) {
    return p.type === "emergency"
      ? { key: `emergency-done:${p.id}`, kind: "emergencyFundDone", title: p.title }
      : { key: `plan-done:${p.id}`, kind: "planDone", title: p.title };
  }
  if (p.goalClass === "investment" || p.goalClass === "wealth") {
    const reached = parseMilestones(p.milestones)
      .filter(m => p.currentAmount >= m && (p.targetAmount <= 0 || m < p.targetAmount))
      .sort((a, b) => b - a)[0];
    if (reached !== undefined) {
      return { key: `plan-milestone:${p.id}:${reached}`, kind: "planMilestone", title: p.title, pct: null, amount: reached };
    }
  } else if (p.targetAmount > 0) {
    // Integers: current/target ≥ pct/100 ⇔ current·100 ≥ target·pct.
    const pct = SAVINGS_MILESTONE_PCTS.find(x => p.currentAmount * 100 >= p.targetAmount * x);
    if (pct !== undefined) {
      return { key: `plan-milestone:${p.id}:pct${pct}`, kind: "planMilestone", title: p.title, pct, amount: null };
    }
  }
  if (p.contributed) return { key: `plan-first:${p.id}`, kind: "planFirstContribution", title: p.title };
  return null;
}

/** The current streak of months meeting "Págate a ti primero": counted from
 *  the open month if it already meets it, else from the last closed one,
 *  back until a month that didn't. `start` is its oldest month. */
export function payYourselfStreak(months: PayYourselfMonth[]): { length: number; start: string | null } {
  const list = months[0] && !months[0].closed && !months[0].met ? months.slice(1) : months;
  let length = 0;
  let start: string | null = null;
  for (const m of list) {
    if (!m.met) break;
    length += 1;
    start = m.month;
  }
  return { length, start };
}

/** Every celebration the facts allow, biggest first (seen or not). */
export function detectCelebrations(f: CelebrationFacts): Celebration[] {
  const out: Celebration[] = [];

  for (const d of f.debts) {
    if (d.status !== "paid_off" || d.kind === "credit_card") continue; // a card is never "closed": it keeps being used
    out.push({ key: `debt-paid:${d.id}`, kind: "debtPaidOff", name: d.name, amount: freedMonthly(d) });
  }

  for (const p of f.plans) {
    const c = planCelebration(p);
    if (c) out.push(c);
  }

  const streak = payYourselfStreak(f.payYourselfFirst);
  if (streak.length > 0) {
    out.push({ key: "pyf-first", kind: "payYourselfFirstFirst" });
    const n = STREAKS.find(s => streak.length >= s);
    if (n !== undefined) out.push({ key: `pyf-streak:${streak.start}:${n}`, kind: "payYourselfFirstStreak", months: n });
  }

  const m = f.lastClosedMonth;
  // Something spent and budgeted: a month with nothing recorded proves nothing.
  if (m && m.budgeted > 0 && m.spent > 0 && m.spent <= m.budgeted) {
    out.push({ key: `budget-month:${m.month}`, kind: "monthWithinBudget", month: m.month });
  }

  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** The ones not seen yet, in order. */
export function unseen(all: Celebration[], seenKeys: Iterable<string>): Celebration[] {
  const seen = new Set(seenKeys);
  return all.filter(c => !seen.has(c.key));
}

// ── Database side ──────────────────────────────────────────────────────────

/** Months back (besides the open one) a streak is looked for: the longest
 *  streak celebrated. */
const PYF_LOOKBACK = STREAKS[0];

async function payYourselfMonths(poolUserId: string, cycleStartDay: number, current: string, now: Date): Promise<PayYourselfMonth[]> {
  const settings = await prisma.userSettings.findUnique({ where: { userId: poolUserId }, select: { payYourselfFirstBps: true } });
  if (!settings?.payYourselfFirstBps) return [];
  const out: PayYourselfMonth[] = [];
  // One month at a time, stopping at the first closed month that didn't meet
  // it: usually one or two reads, at most 13.
  for (let i = 0; i <= PYF_LOOKBACK; i++) {
    const month = periodKeyOffset(current, -i);
    const bounds = periodBounds(month, cycleStartDay);
    const s = await monthSavings(poolUserId, month, bounds);
    const met = s.payYourselfFirstApplies && s.payYourselfFirstGoal !== null && s.payYourselfFirstGoal > 0
      && s.paidYourself >= s.payYourselfFirstGoal;
    const closed = periodEnded(bounds, now);
    out.push({ month, closed, met });
    if (closed && !met) break;
  }
  return out;
}

/** Plans that ever had a positive contribution: a deposit, or a positive net
 *  on their budget line (planLedger.ts). */
async function contributedPlans(poolUserId: string): Promise<Set<string>> {
  const [deposits, lineRows] = await Promise.all([
    prisma.planDeposit.findMany({ where: { userId: poolUserId, amount: { gt: 0 } }, select: { planId: true }, distinct: ["planId"] }),
    prisma.expense.findMany({
      where: { userId: poolUserId, allocation: { type: "plan", lifePlanId: { not: null } } },
      select: { kind: true, amount: true, allocationId: true, allocation: { select: { lifePlanId: true } } },
    }),
  ]);
  const booked = bookedByPlan(lineRows.map(r => ({
    lifePlanId: r.allocation?.lifePlanId ?? null, allocationId: r.allocationId!, kind: r.kind, amount: r.amount,
  })));
  const out = new Set(deposits.map(d => d.planId));
  for (const [planId, net] of booked) if (net > 0) out.add(planId);
  return out;
}

/** Everything the viewer can celebrate right now, seen or not. */
export async function loadCelebrationFacts(poolUserId: string, authUserId: string, now = new Date()): Promise<CelebrationFacts> {
  const cycleStartDay = await getCycleStartDay(poolUserId);
  const current = currentPeriodKey(cycleStartDay, now);
  const lastClosed = periodKeyOffset(current, -1);

  const [plans, contributed, debts, payYourselfFirst, review] = await Promise.all([
    prisma.lifePlan.findMany({
      where: { userId: poolUserId },
      select: { id: true, title: true, type: true, goalClass: true, targetAmount: true, currentAmount: true, milestones: true },
    }),
    contributedPlans(poolUserId),
    prisma.debt.findMany({
      where: { userId: poolUserId, status: "paid_off", ...visibleToWhere(authUserId) },
      select: { id: true, name: true, kind: true, status: true, paymentMode: true, installmentAmount: true, minimumPayment: true },
    }),
    payYourselfMonths(poolUserId, cycleStartDay, current, now),
    monthReview(poolUserId, lastClosed),
  ]);

  return {
    plans: plans.map(p => ({ ...p, contributed: contributed.has(p.id) })),
    debts,
    payYourselfFirst,
    lastClosedMonth: {
      month: lastClosed,
      budgeted: review.totalBudgeted,
      // Categorised spending only, as Home's traffic light compares it.
      spent: review.totalActual - review.unassigned,
    },
  };
}

/** The viewer's celebrations not seen yet, biggest first. */
export async function loadUnseenCelebrations(poolUserId: string, authUserId: string, now = new Date()): Promise<Celebration[]> {
  const [facts, seen] = await Promise.all([
    loadCelebrationFacts(poolUserId, authUserId, now),
    prisma.celebrationSeen.findMany({ where: { userId: authUserId }, select: { key: true } }),
  ]);
  return unseen(detectCelebrations(facts), seen.map(s => s.key));
}
