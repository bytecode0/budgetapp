// One month's budget against what was spent, per budget line, over the whole
// pool: what GET /api/monthly-budgets/review returns (the route then leaves out
// the lines hidden from the caller) and what Home's traffic light and the
// "month closed within budget" celebration (server/lib/celebrations.ts) read.
// Integer cents throughout.
import { prisma } from "./prisma.js";
import { periodBounds, periodEnded } from "./period.js";
import { countedAmounts, debtCommitments, lineBudget } from "./debtBalance.js";
import { getCycleStartDay } from "./getCycleStartDay.js";
import { householdBaselineIncome, householdMonthIncome } from "./householdIncome.js";
import { applyGenerosity, generosityBps } from "./generosity.js";

export async function monthReview(userId: string, month: string) {
  const cycleStartDay = await getCycleStartDay(userId);
  const { start: monthStart, end: monthEnd } = periodBounds(month, cycleStartDay);
  const ended = periodEnded({ end: monthEnd });

  // Get budgets (or fall back to current allocations)
  const savedBudgets = await prisma.monthlyBudget.findMany({
    where: { userId, month },
  });

  const storedAllocations = await prisma.allocation.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });

  // Actual expenses grouped by allocationId
  const expenses = await prisma.expense.findMany({
    where: {
      userId,
      date: { gte: monthStart, lt: monthEnd },
    },
    select: { id: true, allocationId: true, amount: true },
  });

  // Card payments count only for the part that pays pre-existing debt; debt
  // lines without a saved budget take the commitment for THIS period.
  const [counted, commitments] = await Promise.all([
    countedAmounts(userId),
    debtCommitments(userId, { start: monthStart, end: monthEnd }),
  ]);

  const actualByAllocation: Record<string, number> = {};
  for (const e of expenses) {
    const key = e.allocationId ?? "__unassigned__";
    actualByAllocation[key] = (actualByAllocation[key] ?? 0) + (counted.get(e.id) ?? e.amount);
  }

  const savedBy = new Map(savedBudgets.map(b => [b.allocationId, b.allocatedAmount]));

  // The household's income for the month, over the whole pool (not the
  // viewer-filtered /api/income list): what Home compares the budget with,
  // and what a Generosity share is a share of (server/lib/generosity.ts).
  const [recorded, baseline, bps] = await Promise.all([
    prisma.income.findMany({ where: { userId, date: { gte: monthStart, lt: monthEnd } }, select: { amount: true } }),
    householdBaselineIncome(userId),
    generosityBps(userId),
  ]);
  const income = householdMonthIncome(recorded.map(i => i.amount), baseline);
  const allocations = applyGenerosity(storedAllocations, bps, income.cents);

  const review = allocations.map(a => {
    // A debt line: its commitment, or its saved row once the month has
    // ended (lineBudget).
    const budgeted = lineBudget(a, savedBy, commitments, ended);
    const actual   = actualByAllocation[a.id] ?? 0;
    return {
      allocationId: a.id,
      name: a.name,
      icon: a.icon,
      type: a.type,
      budgeted,
      actual,
      diff: actual - budgeted, // positive = over budget
      hasSavedBudget: !!savedBy.get(a.id),
    };
  });

  const unassigned    = actualByAllocation["__unassigned__"] ?? 0;
  const totalBudgeted = review.reduce((s, r) => s + r.budgeted, 0);
  // Include uncategorized spending in the total so it reconciles with the
  // Activity list and analytics (which sum every expense regardless of
  // allocation). `unassigned` is still returned separately so the UI can nudge
  // the user to categorize it.
  const totalActual   = review.reduce((s, r) => s + r.actual, 0) + unassigned;

  return { review, totalBudgeted, totalActual, unassigned, income };
}
