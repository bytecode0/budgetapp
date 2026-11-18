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
//   pyf-streak:<month>:<n>          n = 3, 6 or 12 CLOSED months in a row meeting it;
//                                   <month> is the one in which the streak reached n
//   budget-month:<YYYY-MM>          the last closed month ended within its budget,
//                                   with nothing left uncategorised
//
// Only what is new is celebrated:
//   - Baseline: a person's first read marks everything already true as seen
//     (the "baseline" row) and shows nothing, so nobody gets a pile of old
//     events when this ships or on their first visit.
//   - A plan's starting balance, or a balance typed by hand, is not an
//     achievement: creating a plan or editing its amounts marks what it
//     already reaches as seen for everyone in the pool (markPlanReachedSeen).
// Per plan only the biggest is offered (done > milestone > first contribution),
// and only its highest milestone reached.
//
// Household: plans, the budget and "Págate a ti primero" belong to the shared
// pool, so both members see those. A debt follows its visibility: a private
// one celebrates only for its owner (visibleToWhere, server/lib/ownership.ts).
//
// Never judges: nothing is said when a month is missed. Integer cents.
import { prisma } from "./prisma.js";
import { visibleToWhere } from "./ownership.js";
import { currentPeriodKey, periodBounds, periodKeyFor, periodKeyOffset } from "./period.js";
import { getCycleStartDay } from "./getCycleStartDay.js";
import { payYourselfFirstMet, savingsFrom } from "./payYourselfFirst.js";
import { householdBaselineIncome } from "./householdIncome.js";
import { monthReview } from "./monthReview.js";
import { bookedByPlan } from "./planLedger.js";
import { planContribution } from "./planContribution.js";
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

/** Closed months read back for a streak. Twice the longest streak, so the
 *  month a streak reached 12 is still known for a year after; a streak that
 *  fills the whole window has no known start and celebrates nothing more. */
export const PYF_WINDOW = 2 * STREAKS[0];

/** The mark a person's first read leaves (see the baseline above). */
export const BASELINE_KEY = "baseline";

/** Savings plans: the same 25/50/75 % markers PlanDetail shows (100 % is "done"). */
const SAVINGS_MILESTONE_PCTS = [75, 50, 25] as const;

/** A key the client may send back as seen: lowercase name, then ":"-separated
 *  ids/labels. Bounded; the route also requires it to be a current event. */
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

/** "Págate a ti primero": whether the open month already meets it, and the
 *  closed months newest first (at most PYF_WINDOW). */
export interface PayYourselfFacts {
  openMet: boolean;
  closed: { month: string; met: boolean }[];
}

export interface CelebrationFacts {
  plans: PlanFacts[];
  debts: DebtFacts[];          // only those the viewer may see
  payYourselfFirst: PayYourselfFacts;
  /** The last closed month's budget, or null when there is none to judge. */
  lastClosedMonth: { month: string; budgeted: number; spent: number; unassigned: number } | null; // cents
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

type PlanAmounts = Pick<PlanFacts, "id" | "title" | "type" | "goalClass" | "targetAmount" | "currentAmount" | "milestones">;

/** Every done/milestone celebration the plan's balance reaches, biggest
 *  first (not just the highest): what a balance typed by hand must not
 *  celebrate later. */
export function planReached(p: PlanAmounts): Celebration[] {
  const out: Celebration[] = [];
  if (p.targetAmount > 0 && p.currentAmount >= p.targetAmount) {
    out.push(p.type === "emergency"
      ? { key: `emergency-done:${p.id}`, kind: "emergencyFundDone", title: p.title }
      : { key: `plan-done:${p.id}`, kind: "planDone", title: p.title });
  }
  if (p.goalClass === "investment" || p.goalClass === "wealth") {
    const reached = parseMilestones(p.milestones)
      .filter(m => p.currentAmount >= m && (p.targetAmount <= 0 || m < p.targetAmount))
      .sort((a, b) => b - a);
    for (const m of new Set(reached)) {
      out.push({ key: `plan-milestone:${p.id}:${m}`, kind: "planMilestone", title: p.title, pct: null, amount: m });
    }
  } else if (p.targetAmount > 0) {
    // Integers: current/target ≥ pct/100 ⇔ current·100 ≥ target·pct.
    for (const pct of SAVINGS_MILESTONE_PCTS) {
      if (p.currentAmount * 100 >= p.targetAmount * pct) {
        out.push({ key: `plan-milestone:${p.id}:pct${pct}`, kind: "planMilestone", title: p.title, pct, amount: null });
      }
    }
  }
  return out;
}

function planCelebration(p: PlanFacts): Celebration | null {
  const [biggest] = planReached(p);
  if (biggest) return biggest;
  if (p.contributed) return { key: `plan-first:${p.id}`, kind: "planFirstContribution", title: p.title };
  return null;
}

/** The current streak of CLOSED months meeting "Págate a ti primero", from the
 *  last closed one back. `known` is false when it fills the whole window (its
 *  start, and so the month it reached each length, is unknown). */
export function payYourselfStreak(closed: PayYourselfFacts["closed"]): { length: number; start: string | null; known: boolean } {
  let length = 0;
  let start: string | null = null;
  for (const m of closed) {
    if (!m.met) break;
    length += 1;
    start = m.month;
  }
  return { length, start, known: length < PYF_WINDOW };
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

  const streak = payYourselfStreak(f.payYourselfFirst.closed);
  if (f.payYourselfFirst.openMet || streak.length > 0) out.push({ key: "pyf-first", kind: "payYourselfFirstFirst" });
  const n = STREAKS.find(s => streak.length >= s);
  if (n !== undefined && streak.known && streak.start) {
    // Keyed by the month the streak reached n: the same while it goes on, so
    // it never comes back; a new streak reaches n in another month.
    const reachedIn = periodKeyOffset(streak.start, n - 1);
    out.push({ key: `pyf-streak:${reachedIn}:${n}`, kind: "payYourselfFirstStreak", months: n });
  }

  const m = f.lastClosedMonth;
  // Something spent and budgeted, everything categorised, and within it: a
  // month with nothing recorded, or with money nobody placed, proves nothing.
  if (m && m.budgeted > 0 && m.spent > 0 && m.unassigned === 0 && m.spent <= m.budgeted) {
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

/** "Págate a ti primero" over the open month and PYF_WINDOW closed ones, in
 *  four range reads (not one round per month). The figures are monthSavings'
 *  (savingsFrom), bucketed by each row's period. */
async function payYourselfFacts(poolUserId: string, cycleStartDay: number, current: string): Promise<PayYourselfFacts> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId: poolUserId }, select: { payYourselfFirstBps: true, payYourselfFirstSetAt: true },
  });
  const bps = settings?.payYourselfFirstBps ?? null;
  if (!bps) return { openMet: false, closed: [] };

  const months = Array.from({ length: PYF_WINDOW + 1 }, (_, i) => periodKeyOffset(current, -i)); // newest first
  const range = { gte: periodBounds(months[months.length - 1], cycleStartDay).start, lt: periodBounds(current, cycleStartDay).end };
  const [deposits, lineRows, incomes, baseline] = await Promise.all([
    prisma.planDeposit.findMany({ where: { userId: poolUserId, month: { in: months } }, select: { planId: true, amount: true, month: true } }),
    prisma.expense.findMany({
      where: { userId: poolUserId, date: range, allocation: { type: "plan" } },
      select: { kind: true, amount: true, date: true, allocationId: true, allocation: { select: { lifePlanId: true } } },
    }),
    prisma.income.findMany({ where: { userId: poolUserId, date: range }, select: { amount: true, date: true } }),
    householdBaselineIncome(poolUserId),
  ]);

  const byMonth = <T>(rows: T[], monthOf: (r: T) => string) => {
    const out = new Map<string, T[]>();
    for (const r of rows) {
      const k = monthOf(r);
      out.set(k, [...(out.get(k) ?? []), r]);
    }
    return out;
  };
  const depositsBy = byMonth(deposits, d => d.month);
  const linesBy = byMonth(lineRows, r => periodKeyFor(r.date, cycleStartDay));
  const incomeBy = byMonth(incomes, r => periodKeyFor(r.date, cycleStartDay));

  const met = (month: string) => payYourselfFirstMet(savingsFrom({
    bps,
    setAt: settings?.payYourselfFirstSetAt ?? null,
    periodEnd: periodBounds(month, cycleStartDay).end,
    deposits: depositsBy.get(month) ?? [],
    booked: bookedByPlan((linesBy.get(month) ?? []).map(r => ({
      lifePlanId: r.allocation?.lifePlanId ?? null, allocationId: r.allocationId!, kind: r.kind, amount: r.amount,
    }))),
    recorded: (incomeBy.get(month) ?? []).map(i => i.amount),
    baseline,
  }));

  return { openMet: met(current), closed: months.slice(1).map(month => ({ month, met: met(month) })) };
}

/** Plans that ever had a positive contribution: a deposit, or a positive net
 *  on their budget line (planLedger.ts). Aggregated in the database. */
async function contributedPlans(poolUserId: string): Promise<Set<string>> {
  const [deposits, sums, lines] = await Promise.all([
    prisma.planDeposit.findMany({ where: { userId: poolUserId, amount: { gt: 0 } }, select: { planId: true }, distinct: ["planId"] }),
    prisma.expense.groupBy({
      by: ["allocationId", "kind"],
      where: { userId: poolUserId, allocation: { type: "plan", lifePlanId: { not: null } } },
      _sum: { amount: true },
    }),
    prisma.allocation.findMany({ where: { userId: poolUserId, type: "plan", lifePlanId: { not: null } }, select: { id: true, lifePlanId: true } }),
  ]);
  const planOf = new Map(lines.map(l => [l.id, l.lifePlanId!]));
  const net = new Map<string, number>();
  for (const s of sums) {
    const planId = s.allocationId ? planOf.get(s.allocationId) : undefined;
    if (planId) net.set(planId, (net.get(planId) ?? 0) + planContribution({ kind: s.kind, amount: s._sum.amount ?? 0 }));
  }
  const out = new Set(deposits.map(d => d.planId));
  for (const [planId, n] of net) if (n > 0) out.add(planId);
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
    payYourselfFacts(poolUserId, cycleStartDay, current),
    monthReview(poolUserId, lastClosed, { cycleStartDay, now }),
  ]);

  return {
    plans: plans.map(p => ({ ...p, contributed: contributed.has(p.id) })),
    debts,
    payYourselfFirst,
    lastClosedMonth: {
      month: lastClosed,
      budgeted: review.totalBudgeted,
      // Categorised spending, as Home's traffic light compares it.
      spent: review.totalActual - review.unassigned,
      unassigned: review.unassigned,
    },
  };
}

/** Marks `keys` seen for `userIds`; repeats are ignored. */
async function markSeen(userIds: string[], keys: string[]): Promise<void> {
  if (userIds.length === 0 || keys.length === 0) return;
  await prisma.celebrationSeen.createMany({
    data: userIds.flatMap(userId => keys.map(key => ({ userId, key }))),
    skipDuplicates: true,
  });
}

/** The viewer's celebrations not seen yet, biggest first. On the person's
 *  first read, everything already true is marked seen and nothing is shown. */
export async function loadUnseenCelebrations(poolUserId: string, authUserId: string, now = new Date()): Promise<Celebration[]> {
  const [facts, seen] = await Promise.all([
    loadCelebrationFacts(poolUserId, authUserId, now),
    prisma.celebrationSeen.findMany({ where: { userId: authUserId }, select: { key: true } }),
  ]);
  const all = detectCelebrations(facts);
  const seenKeys = seen.map(s => s.key);
  if (!seenKeys.includes(BASELINE_KEY)) {
    await markSeen([authUserId], [BASELINE_KEY, ...all.map(c => c.key)]);
    return [];
  }
  return unseen(all, seenKeys);
}

/** Whether `key` is one of the viewer's current celebrations (seen or not):
 *  the only keys POST /seen stores. */
export async function isCurrentCelebration(poolUserId: string, authUserId: string, key: string, now = new Date()): Promise<boolean> {
  return detectCelebrations(await loadCelebrationFacts(poolUserId, authUserId, now)).some(c => c.key === key);
}

/** A plan was created or its amounts edited by hand: what its balance already
 *  reaches is not an achievement, so it is marked seen for everyone in the
 *  pool (the pool's owner, every partner linked to it, and the caller). */
export async function markPlanReachedSeen(poolUserId: string, authUserId: string, plan: PlanAmounts): Promise<void> {
  const keys = planReached(plan).map(c => c.key);
  if (keys.length === 0) return;
  const linked = await prisma.userSettings.findMany({ where: { linkedUserId: poolUserId }, select: { userId: true } });
  await markSeen([...new Set([poolUserId, authUserId, ...linked.map(l => l.userId)])], keys);
}
