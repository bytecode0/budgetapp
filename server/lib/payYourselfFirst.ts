// "Te has pagado X de Y este mes" (LPBETA-07): what the household set aside
// for itself this month against its "Págate a ti primero" share.
//
// A plan's contribution in a month is ONE figure (decision of the LPBETA-07
// review): the larger of
//   - its plan deposit for the month (Plans → "Registrar aportación",
//     PlanDeposit.month — the month's total as the user states it), and
//   - the net of the expenses booked on its plan budget line(s) in the period
//     (a transfer to the plan; a refund on it takes money back out —
//     planContribution).
// So money both booked from the bank and registered by hand counts once.
// Used by Home (X), GET /api/plans/monthly-status and the deposit confirm.
//
// Y = the chosen share (UserSettings.payYourselfFirstBps of the pool) of the
//     household's income for the month — the same income Home shows
//     (householdMonthIncome: recorded when any, else the baseline).
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { planContribution } from "./planContribution.js";
import { householdBaselineIncome, householdMonthIncome } from "./householdIncome.js";
import { shareOfIncome } from "../../shared/incomeShare.js";

type Db = typeof prisma | Prisma.TransactionClient;

/** One plan's contribution in a month: max(deposit, booked). Pure. */
export function planMonthContribution(depositedCents: number, bookedCents: number): number {
  return Math.max(depositedCents, bookedCents);
}

/** Net booked per plan from plan-line expenses. A line not linked to a plan
 *  counts on its own (key `line:<id>`). Pure. */
export function bookedByPlan(
  rows: { lifePlanId: string | null; allocationId: string; kind?: string | null; amount: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.lifePlanId ?? `line:${r.allocationId}`;
    out.set(key, (out.get(key) ?? 0) + planContribution(r));
  }
  return out;
}

/** X: every plan's month contribution, summed. Pure. */
export function sumPaidYourself(
  deposits: { planId: string; amount: number }[],
  booked: Map<string, number>,
): number {
  const deposited = new Map<string, number>();
  for (const d of deposits) deposited.set(d.planId, (deposited.get(d.planId) ?? 0) + d.amount);
  const keys = new Set([...deposited.keys(), ...booked.keys()]);
  let total = 0;
  for (const k of keys) total += planMonthContribution(deposited.get(k) ?? 0, booked.get(k) ?? 0);
  return total;
}

/** Net booked on plan lines in the period, per plan (cents). */
export async function loadBookedByPlan(
  db: Db,
  poolUserId: string,
  bounds: { start: Date; end: Date },
  planIds?: string[],
): Promise<Map<string, number>> {
  const rows = await db.expense.findMany({
    where: {
      userId: poolUserId,
      date: { gte: bounds.start, lt: bounds.end },
      allocation: { type: "plan", ...(planIds && { lifePlanId: { in: planIds } }) },
    },
    select: { kind: true, amount: true, allocationId: true, allocation: { select: { lifePlanId: true } } },
  });
  return bookedByPlan(rows.map(r => ({
    lifePlanId: r.allocation?.lifePlanId ?? null,
    allocationId: r.allocationId!,
    kind: r.kind,
    amount: r.amount,
  })));
}

export interface MonthSavings {
  householdIncome: number;          // cents
  paidYourself: number;             // cents
  payYourselfFirstBps: number | null;
  payYourselfFirstGoal: number | null; // cents; null without a chosen share
  /** False for a month that ended before the share was chosen or last
   *  changed: that month is not judged by it. */
  payYourselfFirstApplies: boolean;
}

/** Whether a share chosen at `setAt` judges the period ending at `end`. Pure. */
export function shareApplies(setAt: Date | null, end: Date): boolean {
  return setAt === null || setAt < end;
}

/** The pool's savings figures for `month` (its period is `bounds`). */
export async function monthSavings(poolUserId: string, month: string, bounds: { start: Date; end: Date }): Promise<MonthSavings> {
  const range = { gte: bounds.start, lt: bounds.end };
  const [settings, deposits, booked, recorded, baseline] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: poolUserId }, select: { payYourselfFirstBps: true, payYourselfFirstSetAt: true } }),
    prisma.planDeposit.findMany({ where: { userId: poolUserId, month }, select: { planId: true, amount: true } }),
    loadBookedByPlan(prisma, poolUserId, bounds),
    prisma.income.findMany({ where: { userId: poolUserId, date: range }, select: { amount: true } }),
    householdBaselineIncome(poolUserId),
  ]);
  const income = householdMonthIncome(recorded.map(i => i.amount), baseline).cents;
  const bps = settings?.payYourselfFirstBps ?? null;
  return {
    householdIncome: income,
    paidYourself: sumPaidYourself(deposits, booked),
    payYourselfFirstBps: bps,
    payYourselfFirstGoal: bps === null ? null : shareOfIncome(income, bps),
    payYourselfFirstApplies: bps !== null && shareApplies(settings?.payYourselfFirstSetAt ?? null, bounds.end),
  };
}
