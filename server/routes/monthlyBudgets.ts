import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { periodBounds } from "../lib/period.js";
import { ALLOCATION_NOT_FOUND, allocationsInPool } from "../lib/poolRefs.js";
import { countedAmounts, debtCommitments } from "../lib/debtBalance.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";

export const monthlyBudgetsRouter = Router();

// GET /api/monthly-budgets?month=2026-04
// Returns budget rows for the month. If none saved yet, returns current allocation amounts.
monthlyBudgetsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month) return res.status(400).json({ error: "month is required (YYYY-MM)" });

    const saved = await prisma.monthlyBudget.findMany({
      where: { userId: req.userId!, month },
      include: {
        allocation: {
          select: { id: true, name: true, icon: true, type: true, sortOrder: true },
        },
      },
    });

    // If nothing saved, fall back to current allocation settings
    if (saved.length === 0) {
      const allocations = await prisma.allocation.findMany({
        where: { userId: req.userId! },
        orderBy: { sortOrder: "asc" },
      });
      // A debt line's amount is its commitment for THIS month, not the stored
      // column (which is only refreshed when the debt itself is edited).
      const cycleStartDay = await getCycleStartDay(req.userId!);
      const commitments = await debtCommitments(req.userId!, periodBounds(month, cycleStartDay));
      return res.json(serializeMoney({
        budgets: allocations.map(a => ({
          allocationId: a.id,
          month,
          allocatedAmount: a.type === "debt" && a.debtId ? commitments.get(a.debtId) ?? a.allocatedAmount : a.allocatedAmount,
          allocation: { id: a.id, name: a.name, icon: a.icon, type: a.type, sortOrder: a.sortOrder },
          saved: false, // flag: not yet saved for this specific month
        })),
      }));
    }

    return res.json(serializeMoney({ budgets: saved.map(b => ({ ...b, saved: true })) }));
  } catch (err) {
    console.error("[monthly-budgets/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/monthly-budgets/save
// Upsert budget amounts for a month
monthlyBudgetsRouter.post("/save", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month, budgets } = req.body as {
      month: string;
      budgets: { allocationId: string; allocatedAmount: number }[];
    };

    if (!month || !Array.isArray(budgets)) {
      return res.status(400).json({ error: "month and budgets array are required" });
    }

    // Every line must be one of the pool's (a budget always names one).
    if (budgets.some(b => !b?.allocationId) || !(await allocationsInPool(req.userId!, budgets.map(b => b.allocationId)))) {
      return res.status(404).json(ALLOCATION_NOT_FOUND);
    }

    await Promise.all(
      budgets.map(b =>
        prisma.monthlyBudget.upsert({
          where: { allocationId_month: { allocationId: b.allocationId, month } },
          update: { allocatedAmount: toCents(b.allocatedAmount) },
          create: {
            userId: req.userId!,
            allocationId: b.allocationId,
            month,
            allocatedAmount: toCents(b.allocatedAmount),
          },
        })
      )
    );

    const updated = await prisma.monthlyBudget.findMany({
      where: { userId: req.userId!, month },
      include: {
        allocation: {
          select: { id: true, name: true, icon: true, type: true, sortOrder: true },
        },
      },
    });

    return res.json(serializeMoney({ budgets: updated.map(b => ({ ...b, saved: true })) }));
  } catch (err) {
    console.error("[monthly-budgets/save]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/monthly-budgets/review?month=2026-03
// Returns budget + actual expenses per allocation for a past month
monthlyBudgetsRouter.get("/review", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month) return res.status(400).json({ error: "month is required" });

    const cycleStartDay = await getCycleStartDay(req.userId!);
    const { start: monthStart, end: monthEnd } = periodBounds(month, cycleStartDay);

    // Get budgets (or fall back to current allocations)
    const savedBudgets = await prisma.monthlyBudget.findMany({
      where: { userId: req.userId!, month },
    });

    const allocations = await prisma.allocation.findMany({
      where: { userId: req.userId! },
      orderBy: { sortOrder: "asc" },
    });

    // Actual expenses grouped by allocationId
    const expenses = await prisma.expense.findMany({
      where: {
        userId: req.userId!,
        date: { gte: monthStart, lt: monthEnd },
      },
      select: { id: true, allocationId: true, amount: true },
    });

    // Card payments count only for the part that pays pre-existing debt; debt
    // lines without a saved budget take the commitment for THIS period.
    const [counted, commitments] = await Promise.all([
      countedAmounts(req.userId!),
      debtCommitments(req.userId!, { start: monthStart, end: monthEnd }),
    ]);

    const actualByAllocation: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.allocationId ?? "__unassigned__";
      actualByAllocation[key] = (actualByAllocation[key] ?? 0) + (counted.get(e.id) ?? e.amount);
    }

    const budgetMap: Record<string, number> = {};
    for (const b of savedBudgets) {
      budgetMap[b.allocationId] = b.allocatedAmount;
    }

    const review = allocations.map(a => {
      const fallback = a.type === "debt" && a.debtId ? commitments.get(a.debtId) ?? a.allocatedAmount : a.allocatedAmount;
      const budgeted = budgetMap[a.id] ?? fallback;
      const actual   = actualByAllocation[a.id] ?? 0;
      return {
        allocationId: a.id,
        name: a.name,
        icon: a.icon,
        type: a.type,
        budgeted,
        actual,
        diff: actual - budgeted, // positive = over budget
        hasSavedBudget: !!budgetMap[a.id],
      };
    });

    const unassigned    = actualByAllocation["__unassigned__"] ?? 0;
    const totalBudgeted = review.reduce((s, r) => s + r.budgeted, 0);
    // Include uncategorized spending in the total so it reconciles with the
    // Activity list and analytics (which sum every expense regardless of
    // allocation). `unassigned` is still returned separately so the UI can nudge
    // the user to categorize it.
    const totalActual   = review.reduce((s, r) => s + r.actual, 0) + unassigned;

    return res.json(serializeMoney({ review, totalBudgeted, totalActual, unassigned, month }));
  } catch (err) {
    console.error("[monthly-budgets/review]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
