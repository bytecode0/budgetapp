// "Te has pagado X de Y este mes" (LPBETA-07): what the household set aside
// for itself this month against its "Págate a ti primero" share.
//
// X = the month's contributions to savings plans, through either of the two
//     ways the app records one: a plan deposit for the month (Plans →
//     "Registrar aportación", PlanDeposit.month) and expenses booked on a
//     plan budget line in the period (a transfer to the plan; a refund on it
//     takes money back out — planContribution).
// Y = the chosen share (UserSettings.payYourselfFirstBps of the pool) of the
//     household's income for the month — the same income Home shows
//     (householdMonthIncome: recorded when any, else the baseline).
import { prisma } from "./prisma.js";
import { planContribution } from "./planContribution.js";
import { householdBaselineIncome, householdMonthIncome } from "./householdIncome.js";
import { shareOfIncome } from "../../shared/incomeShare.js";

/** Plan deposits of the month plus net plan-line expenses, in cents. Pure. */
export function sumPaidYourself(
  depositCents: number[],
  planLineExpenses: { kind?: string | null; amount: number }[],
): number {
  return depositCents.reduce((s, n) => s + n, 0)
    + planLineExpenses.reduce((s, e) => s + planContribution(e), 0);
}

export interface MonthSavings {
  householdIncome: number;          // cents
  paidYourself: number;             // cents
  payYourselfFirstBps: number | null;
  payYourselfFirstGoal: number | null; // cents; null without a chosen share
}

/** The pool's savings figures for `month` (its period is `bounds`). */
export async function monthSavings(poolUserId: string, month: string, bounds: { start: Date; end: Date }): Promise<MonthSavings> {
  const range = { gte: bounds.start, lt: bounds.end };
  const [settings, deposits, planExpenses, recorded, baseline] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: poolUserId }, select: { payYourselfFirstBps: true } }),
    prisma.planDeposit.findMany({ where: { userId: poolUserId, month }, select: { amount: true } }),
    prisma.expense.findMany({
      where: { userId: poolUserId, date: range, allocation: { type: "plan" } },
      select: { kind: true, amount: true },
    }),
    prisma.income.findMany({ where: { userId: poolUserId, date: range }, select: { amount: true } }),
    householdBaselineIncome(poolUserId),
  ]);
  const income = householdMonthIncome(recorded.map(i => i.amount), baseline).cents;
  const bps = settings?.payYourselfFirstBps ?? null;
  return {
    householdIncome: income,
    paidYourself: sumPaidYourself(deposits.map(d => d.amount), planExpenses),
    payYourselfFirstBps: bps,
    payYourselfFirstGoal: bps === null ? null : shareOfIncome(income, bps),
  };
}
