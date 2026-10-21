import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { periodBounds, periodKeyFor, enumeratePeriods } from "../lib/period.js";
import { countedAmounts, debtCommitments } from "../lib/debtBalance.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";

export const analyticsRouter = Router();

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_MONTHS = 24; // guard against unbounded ranges

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// GET /api/analytics?from=YYYY-MM&to=YYYY-MM
// Multi-month aggregation for the dashboard: spending month-over-month, average
// spend per category, savings trend (from PlanDeposit), and a spending-plan
// alignment score for the `to` month (used by the sidebar indicator).
analyticsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to || !MONTH_RE.test(from) || !MONTH_RE.test(to)) {
      return res.status(400).json({ error: "from and to are required (YYYY-MM)" });
    }
    if (from > to) {
      return res.status(400).json({ error: "from must be <= to" });
    }

    const months = enumeratePeriods(from, to);
    if (months.length > MAX_MONTHS) {
      return res.status(400).json({ error: `range too large (max ${MAX_MONTHS} months)` });
    }

    const userId = req.userId!;
    const cycleStartDay = await getCycleStartDay(userId);
    const rangeStart = periodBounds(from, cycleStartDay).start;
    const rangeEnd = periodBounds(to, cycleStartDay).end; // exclusive: end of the `to` period

    const [expenses, incomes, allocations, depositsInRange, baselineAgg] = await Promise.all([
      prisma.expense.findMany({
        where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
        select: { id: true, allocationId: true, amount: true, date: true },
      }),
      prisma.income.findMany({
        where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
        select: { amount: true, date: true },
      }),
      prisma.allocation.findMany({
        where: { userId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, icon: true, type: true, allocatedAmount: true, debtId: true },
      }),
      prisma.planDeposit.findMany({
        where: { userId, month: { in: months } },
        select: { month: true, amount: true },
      }),
      // Cumulative savings carried into the range = everything deposited before `from`.
      prisma.planDeposit.aggregate({
        where: { userId, month: { lt: from } },
        _sum: { amount: true },
      }),
    ]);

    // A card payment only counts for the part that pays pre-existing debt.
    const counted = await countedAmounts(userId);
    const spent = (e: { id: string; amount: number }) => counted.get(e.id) ?? e.amount;

    // ── Spending month over month ──
    const spentByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));
    // ── Average spend per category (categorized expenses only) ──
    const totalByAllocation: Record<string, number> = {};
    for (const e of expenses) {
      const mKey = periodKeyFor(e.date, cycleStartDay);
      if (mKey in spentByMonth) spentByMonth[mKey] += spent(e);
      if (e.allocationId) {
        totalByAllocation[e.allocationId] = (totalByAllocation[e.allocationId] ?? 0) + spent(e);
      }
    }

    // ── Income month over month (cashflow alongside spending) ──
    const incomeByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));
    for (const inc of incomes) {
      const mKey = periodKeyFor(inc.date, cycleStartDay);
      if (mKey in incomeByMonth) incomeByMonth[mKey] += inc.amount;
    }

    const monthsSeries = months.map(m => ({ month: m, total: spentByMonth[m], income: incomeByMonth[m] }));

    const allocMap = Object.fromEntries(allocations.map(a => [a.id, a]));
    const byCategory = Object.entries(totalByAllocation)
      .map(([allocationId, total]) => {
        const a = allocMap[allocationId];
        return {
          allocationId,
          name: a?.name ?? "—",
          icon: a?.icon ?? "💰",
          total,
          avg: Math.round(total / months.length),
        };
      })
      .sort((x, y) => y.total - x.total);

    // ── Savings trend (cumulative balance derived from PlanDeposit) ──
    const depositByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));
    for (const d of depositsInRange) {
      depositByMonth[d.month] = (depositByMonth[d.month] ?? 0) + d.amount;
    }
    let running = baselineAgg._sum.amount ?? 0;
    const savings = months.map(m => {
      running += depositByMonth[m];
      return { month: m, deposited: depositByMonth[m], cumulative: running };
    });

    // ── Spending-plan alignment for the `to` month (replaces the sidebar mock) ──
    const toBounds = periodBounds(to, cycleStartDay);
    const [savedBudgets, toExpenses] = await Promise.all([
      prisma.monthlyBudget.findMany({ where: { userId, month: to } }),
      prisma.expense.findMany({
        where: { userId, date: { gte: toBounds.start, lt: toBounds.end } },
        select: { id: true, amount: true },
      }),
    ]);
    const budgetMap: Record<string, number> = Object.fromEntries(
      savedBudgets.map(b => [b.allocationId, b.allocatedAmount])
    );
    // Budget = saved month budgets, or the current allocation amounts as a
    // fallback (a debt line's being its commitment for that period).
    const commitments = await debtCommitments(userId, toBounds);
    const totalBudgeted = allocations.reduce(
      (s, a) => s + (budgetMap[a.id] ?? (a.type === "debt" && a.debtId ? commitments.get(a.debtId) : undefined) ?? a.allocatedAmount), 0
    );
    const totalActual = toExpenses.reduce((s, e) => s + spent(e), 0);
    const overspend = Math.max(0, totalActual - totalBudgeted);
    const pct = totalBudgeted > 0
      ? clamp(Math.round(100 - (overspend / totalBudgeted) * 100), 0, 100)
      : (totalActual === 0 ? 100 : 0);

    return res.json(serializeMoney({
      from,
      to,
      months: monthsSeries,
      byCategory,
      savings,
      alignment: { month: to, pct, budgeted: totalBudgeted, actual: totalActual },
    }));
  } catch (err) {
    console.error("[analytics/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
