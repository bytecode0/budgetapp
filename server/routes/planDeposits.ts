import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

export const planDepositsRouter = Router();

// GET /api/plan-deposits?month=2026-04
// Returns deposits for the given month for the current user
planDepositsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month) return res.status(400).json({ error: "month is required (YYYY-MM)" });

    const deposits = await prisma.planDeposit.findMany({
      where: { userId: req.userId!, month },
      include: { plan: { select: { id: true, title: true, icon: true, color: true, targetAmount: true, currentAmount: true } } },
    });

    return res.json({ deposits });
  } catch (err) {
    console.error("[plan-deposits/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plan-deposits/confirm
// Batch upsert deposits for a month, then recalculate currentAmount for each plan
planDepositsRouter.post("/confirm", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month, deposits } = req.body as {
      month: string;
      deposits: { planId: string; amount: number; note?: string }[];
    };

    if (!month || !Array.isArray(deposits)) {
      return res.status(400).json({ error: "month and deposits array are required" });
    }

    // Verify all plans belong to the user
    const planIds = deposits.map(d => d.planId);
    const userPlans = await prisma.lifePlan.findMany({
      where: { id: { in: planIds }, userId: req.userId! },
      select: { id: true },
    });
    const validPlanIds = new Set(userPlans.map(p => p.id));
    if (deposits.some(d => !validPlanIds.has(d.planId))) {
      return res.status(403).json({ error: "One or more plans not found" });
    }

    // Upsert each deposit
    await Promise.all(
      deposits.map(d =>
        prisma.planDeposit.upsert({
          where: { planId_month: { planId: d.planId, month } },
          update: { amount: d.amount, note: d.note ?? "" },
          create: {
            userId: req.userId!,
            planId: d.planId,
            month,
            amount: d.amount,
            note: d.note ?? "",
          },
        })
      )
    );

    // Recalculate currentAmount for each affected plan = sum of all deposits
    await Promise.all(
      planIds.map(async planId => {
        const { _sum } = await prisma.planDeposit.aggregate({
          where: { planId },
          _sum: { amount: true },
        });
        await prisma.lifePlan.update({
          where: { id: planId },
          data: { currentAmount: _sum.amount ?? 0 },
        });
      })
    );

    // Return updated deposits with plan info
    const updated = await prisma.planDeposit.findMany({
      where: { userId: req.userId!, month },
      include: { plan: { select: { id: true, title: true, icon: true, color: true, targetAmount: true, currentAmount: true } } },
    });

    return res.json({ deposits: updated });
  } catch (err) {
    console.error("[plan-deposits/confirm]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
