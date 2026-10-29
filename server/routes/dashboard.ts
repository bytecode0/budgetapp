import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toEuros } from "../lib/money.js";
import { periodBounds } from "../lib/period.js";
import { spentByPerson } from "../lib/personSpending.js";
import { countedAmounts } from "../lib/debtBalance.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";

export const dashboardRouter = Router();

// GET /api/dashboard/household?period=YYYY-MM (Epic H8)
// Household-level aggregates: financial health, per-person breakdown and per-
// category spend. These are shared at the shared_stats tier (no transaction
// detail leaks — only totals), so no per-viewer filtering is applied here.
dashboardRouter.get("/household", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const pool = req.userId!;
    const period = typeof req.query.period === "string" ? req.query.period : undefined;
    let range: { gte: Date; lt: Date } | undefined;
    if (period && /^\d{4}-\d{2}$/.test(period)) {
      const cycleStartDay = await getCycleStartDay(pool);
      const { start, end } = periodBounds(period, cycleStartDay);
      range = { gte: start, lt: end };
    }

    // Members (active) for the per-person breakdown.
    const members = req.householdId
      ? await prisma.householdMember.findMany({
          where: { householdId: req.householdId, status: "active" },
          include: { user: { select: { id: true, name: true, email: true } } },
        })
      : [];
    const nameById = Object.fromEntries(members.map(m => [m.userId, m.user.name ?? m.user.email]));
    const memberIds = members.map(m => m.userId);

    const [expenses, incomes, accounts, allocations] = await Promise.all([
      prisma.expense.findMany({
        where: { userId: pool, ...(range ? { date: range } : {}) },
        select: { id: true, amount: true, allocationId: true, scope: true, payerUserId: true, beneficiaryUserId: true, shares: { select: { userId: true, amount: true } } },
      }),
      prisma.income.findMany({
        where: { userId: pool, ...(range ? { date: range } : {}) },
        select: { amount: true, ownerUserId: true },
      }),
      prisma.account.findMany({ where: { userId: pool, isArchived: false }, select: { currentBalance: true } }),
      prisma.allocation.findMany({ where: { userId: pool }, select: { id: true, name: true, icon: true } }),
    ]);

    // A card payment only counts for the part that pays pre-existing debt — the
    // rest pays for purchases already counted in their category.
    const counted = await countedAmounts(pool);
    const spent = (e: { id: string; amount: number }) => counted.get(e.id) ?? e.amount;

    const incomeTotal = incomes.reduce((s, i) => s + i.amount, 0);
    const expenseTotal = expenses.reduce((s, e) => s + spent(e), 0);
    const savings = incomeTotal - expenseTotal;
    const netWorth = accounts.reduce((s, a) => s + a.currentBalance, 0);

    // Per person: income earned, amount consumed (shares for shared, beneficiary/
    // payer for personal), and income-share contribution %.
    const incomeBy: Record<string, number> = Object.fromEntries(memberIds.map(id => [id, 0]));
    for (const i of incomes) if (i.ownerUserId in incomeBy) incomeBy[i.ownerUserId] += i.amount;
    const spentBy = spentByPerson(expenses, memberIds, counted);
    const byPerson = members.map(m => ({
      userId: m.userId,
      name: nameById[m.userId],
      income: toEuros(incomeBy[m.userId]),
      spent: toEuros(spentBy[m.userId]),
      contributionPct: incomeTotal > 0
        ? Math.round((incomeBy[m.userId] / incomeTotal) * 1000) / 10
        : (memberIds.length ? Math.round((100 / memberIds.length) * 10) / 10 : 0),
    }));

    // Per category (combined).
    const allocMap = Object.fromEntries(allocations.map(a => [a.id, a]));
    const byAlloc: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.allocationId ?? "__unassigned__";
      byAlloc[key] = (byAlloc[key] ?? 0) + spent(e);
    }
    const byCategory = Object.entries(byAlloc)
      .map(([id, total]) => ({
        allocationId: id === "__unassigned__" ? null : id,
        name: allocMap[id]?.name ?? null,
        icon: allocMap[id]?.icon ?? "❓",
        total: toEuros(total),
      }))
      .sort((a, b) => b.total - a.total);

    return res.json({
      period: period ?? null,
      health: {
        income: toEuros(incomeTotal),
        expenses: toEuros(expenseTotal),
        savings: toEuros(savings),
        savingsRate: incomeTotal > 0 ? Math.round((savings / incomeTotal) * 1000) / 10 : 0,
        netWorth: toEuros(netWorth),
      },
      byPerson,
      byCategory,
    });
  } catch (err) {
    console.error("[dashboard/household]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
