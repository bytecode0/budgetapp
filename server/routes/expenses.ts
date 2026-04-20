import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

export const expensesRouter = Router();

// GET /api/expenses?month=2026-04&allocationId=xxx
expensesRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month, allocationId } = req.query as Record<string, string>;

    const where: any = { userId: req.userId! };

    if (month) {
      const [year, mon] = month.split("-").map(Number);
      where.date = {
        gte: new Date(year, mon - 1, 1),
        lt: new Date(year, mon, 1),
      };
    }

    if (allocationId) {
      where.allocationId = allocationId === "unassigned" ? null : allocationId;
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: { allocation: { select: { id: true, name: true, icon: true, type: true } } },
      orderBy: { date: "desc" },
    });

    return res.json({ expenses });
  } catch (err) {
    console.error("[expenses/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses
expensesRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, description, allocationId, date } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    const parsedAmount = parseFloat(amount);

    const expense = await prisma.expense.create({
      data: {
        userId: req.userId!,
        amount: parsedAmount,
        description: description ?? "",
        allocationId: allocationId || null,
        date: date ? new Date(date) : new Date(),
      },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true, lifePlanId: true } } },
    });

    // Auto-contribute to linked life plan if this is a plan allocation
    if (expense.allocation?.type === "plan" && expense.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: expense.allocation.lifePlanId },
        data: { currentAmount: { increment: parsedAmount } },
      });
    }

    return res.json({ expense });
  } catch (err) {
    console.error("[expenses/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/expenses/:id
expensesRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findFirst({
      where: { id, userId: req.userId! },
      include: { allocation: { select: { type: true, lifePlanId: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    const { amount, description, allocationId, date } = req.body;

    // Resolve the allocation that will apply after the update
    const newAllocId = allocationId !== undefined ? (allocationId || null) : existing.allocationId;
    const newAlloc = newAllocId ? await prisma.allocation.findFirst({
      where: { id: newAllocId },
      select: { type: true, lifePlanId: true },
    }) : null;
    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount;

    // Reverse old plan contribution
    if (existing.allocation?.type === "plan" && existing.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: existing.allocation.lifePlanId },
        data: { currentAmount: { decrement: existing.amount } },
      });
    }
    // Apply new plan contribution
    if (newAlloc?.type === "plan" && newAlloc.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: newAlloc.lifePlanId },
        data: { currentAmount: { increment: newAmount } },
      });
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(amount !== undefined && { amount: newAmount }),
        ...(description !== undefined && { description }),
        ...(allocationId !== undefined && { allocationId: allocationId || null }),
        ...(date !== undefined && { date: new Date(date) }),
      },
      include: { allocation: { select: { id: true, name: true, icon: true, type: true, lifePlanId: true } } },
    });

    return res.json({ expense });
  } catch (err) {
    console.error("[expenses/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/expenses/:id
expensesRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.expense.findFirst({
      where: { id, userId: req.userId! },
      include: { allocation: { select: { type: true, lifePlanId: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Expense not found" });

    await prisma.expense.delete({ where: { id } });

    // Reverse plan contribution if applicable
    if (existing.allocation?.type === "plan" && existing.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: existing.allocation.lifePlanId },
        data: { currentAmount: { decrement: existing.amount } },
      });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[expenses/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
