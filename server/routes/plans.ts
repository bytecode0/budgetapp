import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

export const plansRouter = Router();

// GET /api/plans
plansRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const plans = await prisma.lifePlan.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ plans });
  } catch (err) {
    console.error("[plans/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plans
plansRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, goalClass, type, icon, color, targetAmount, currentAmount, monthlyContribution, deadline, milestones } = req.body;

    if (!title || !targetAmount) {
      return res.status(400).json({ error: "Title and target amount are required" });
    }

    const plan = await prisma.lifePlan.create({
      data: {
        userId: req.userId!,
        title,
        description: description ?? "",
        goalClass: goalClass ?? "savings",
        type: type ?? "other",
        icon: icon ?? "🎯",
        color: color ?? "#1E3A8A",
        targetAmount: parseFloat(targetAmount),
        currentAmount: currentAmount ? parseFloat(currentAmount) : 0,
        monthlyContribution: monthlyContribution ? parseFloat(monthlyContribution) : 0,
        deadline: deadline ? new Date(deadline) : null,
        milestones: milestones ?? "[]",
      },
    });

    return res.json({ plan });
  } catch (err) {
    console.error("[plans/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/plans/:id
plansRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.lifePlan.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Plan not found" });

    const { title, description, goalClass, type, icon, color, targetAmount, currentAmount, monthlyContribution, deadline, milestones } = req.body;

    const plan = await prisma.lifePlan.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(goalClass !== undefined && { goalClass }),
        ...(type !== undefined && { type }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        ...(targetAmount !== undefined && { targetAmount: parseFloat(targetAmount) }),
        ...(currentAmount !== undefined && { currentAmount: parseFloat(currentAmount) }),
        ...(monthlyContribution !== undefined && { monthlyContribution: parseFloat(monthlyContribution) }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(milestones !== undefined && { milestones }),
      },
    });

    return res.json({ plan });
  } catch (err) {
    console.error("[plans/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plans/:id/contribute
plansRouter.post("/:id/contribute", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    const existing = await prisma.lifePlan.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Plan not found" });

    const plan = await prisma.lifePlan.update({
      where: { id },
      data: { currentAmount: { increment: amount } },
    });
    return res.json({ plan });
  } catch (err) {
    console.error("[plans/contribute]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/plans/:id
plansRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.lifePlan.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Plan not found" });

    await prisma.lifePlan.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[plans/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
