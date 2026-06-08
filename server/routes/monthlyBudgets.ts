import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";

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
      return res.json(serializeMoney({
        budgets: allocations.map(a => ({
          allocationId: a.id,
          month,
          allocatedAmount: a.allocatedAmount,
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

    // Verify allocations belong to user
    const allocationIds = budgets.map(b => b.allocationId);
    const userAllocs = await prisma.allocation.findMany({
      where: { id: { in: allocationIds }, userId: req.userId! },
      select: { id: true },
    });
    const validIds = new Set(userAllocs.map(a => a.id));
    if (budgets.some(b => !validIds.has(b.allocationId))) {
      return res.status(403).json({ error: "One or more allocations not found" });
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

    const [year, mon] = month.split("-").map(Number);
    const monthStart = new Date(year, mon - 1, 1);
    const monthEnd   = new Date(year, mon, 1);

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
      select: { allocationId: true, amount: true },
    });

    const actualByAllocation: Record<string, number> = {};
    for (const e of expenses) {
      const key = e.allocationId ?? "__unassigned__";
      actualByAllocation[key] = (actualByAllocation[key] ?? 0) + e.amount;
    }

    const budgetMap: Record<string, number> = {};
    for (const b of savedBudgets) {
      budgetMap[b.allocationId] = b.allocatedAmount;
    }

    const review = allocations.map(a => {
      const budgeted = budgetMap[a.id] ?? a.allocatedAmount;
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

    const totalBudgeted = review.reduce((s, r) => s + r.budgeted, 0);
    const totalActual   = review.reduce((s, r) => s + r.actual,   0);
    const unassigned    = actualByAllocation["__unassigned__"] ?? 0;

    return res.json(serializeMoney({ review, totalBudgeted, totalActual, unassigned, month }));
  } catch (err) {
    console.error("[monthly-budgets/review]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
