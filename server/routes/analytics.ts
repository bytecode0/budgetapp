import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";

export const analyticsRouter = Router();

const MONTH_RE = /^\d{4}-\d{2}$/;
const MAX_MONTHS = 24; // guard against unbounded ranges

function monthKey(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

// Local-time month key for an expense date (matches the month filtering used
// elsewhere, e.g. expenses/monthly-budgets, which build dates with new Date(y, m-1)).
function dateToMonthKey(d: Date): string {
  return monthKey(d.getFullYear(), d.getMonth() + 1);
}

// Inclusive list of "YYYY-MM" keys from `from` to `to`.
function enumerateMonths(from: string, to: string): string[] {
  const result: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    result.push(monthKey(y, m));
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

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

    const months = enumerateMonths(from, to);
    if (months.length > MAX_MONTHS) {
      return res.status(400).json({ error: `range too large (max ${MAX_MONTHS} months)` });
    }

    const [fy, fm] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    const rangeStart = new Date(fy, fm - 1, 1);
    const rangeEnd = new Date(ty, tm, 1); // exclusive: first day of the month after `to`

    const userId = req.userId!;

    const [expenses, incomes, allocations, depositsInRange, baselineAgg] = await Promise.all([
      prisma.expense.findMany({
        where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
        select: { allocationId: true, amount: true, date: true },
      }),
      prisma.income.findMany({
        where: { userId, date: { gte: rangeStart, lt: rangeEnd } },
        select: { amount: true, date: true },
      }),
      prisma.allocation.findMany({
        where: { userId },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, icon: true, type: true, allocatedAmount: true },
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

    // ── Spending month over month ──
    const spentByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));
    // ── Average spend per category (categorized expenses only) ──
    const totalByAllocation: Record<string, number> = {};
    for (const e of expenses) {
      const mKey = dateToMonthKey(e.date);
      if (mKey in spentByMonth) spentByMonth[mKey] += e.amount;
      if (e.allocationId) {
        totalByAllocation[e.allocationId] = (totalByAllocation[e.allocationId] ?? 0) + e.amount;
      }
    }

    // ── Income month over month (cashflow alongside spending) ──
    const incomeByMonth: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));
    for (const inc of incomes) {
      const mKey = dateToMonthKey(inc.date);
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
    const [savedBudgets, toExpenses] = await Promise.all([
      prisma.monthlyBudget.findMany({ where: { userId, month: to } }),
      prisma.expense.findMany({
        where: { userId, date: { gte: new Date(ty, tm - 1, 1), lt: new Date(ty, tm, 1) } },
        select: { amount: true },
      }),
    ]);
    const budgetMap: Record<string, number> = Object.fromEntries(
      savedBudgets.map(b => [b.allocationId, b.allocatedAmount])
    );
    // Budget = saved month budgets, or the current allocation amounts as a fallback.
    const totalBudgeted = allocations.reduce(
      (s, a) => s + (budgetMap[a.id] ?? a.allocatedAmount), 0
    );
    const totalActual = toExpenses.reduce((s, e) => s + e.amount, 0);
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
