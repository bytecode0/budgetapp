// "Te has pagado X de Y este mes" (LPBETA-07): what the household set aside
// for itself this month against its "Págate a ti primero" share.
//
// X = every plan's contribution this month, by the one rule in
//     server/lib/planLedger.ts (with a deposit: max(deposit, booked on its
//     line); without: booked, which may be negative). Money both booked from
//     the bank and registered by hand counts once.
//
// Y = the chosen share (UserSettings.payYourselfFirstBps of the pool) of the
//     household's income for the month — the same income Home shows
//     (householdMonthIncome: recorded when any, else the baseline).
import { prisma } from "./prisma.js";
import { loadBookedByPlan, sumContributions } from "./planLedger.js";
import { householdBaselineIncome, householdMonthIncome } from "./householdIncome.js";
import { shareOfIncome } from "../../shared/incomeShare.js";

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
    paidYourself: sumContributions(deposits, booked),
    payYourselfFirstBps: bps,
    payYourselfFirstGoal: bps === null ? null : shareOfIncome(income, bps),
    payYourselfFirstApplies: bps !== null && shareApplies(settings?.payYourselfFirstSetAt ?? null, bounds.end),
  };
}
