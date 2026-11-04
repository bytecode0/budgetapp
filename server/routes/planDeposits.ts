import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";

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

    return res.json(serializeMoney({ deposits }));
  } catch (err) {
    console.error("[plan-deposits/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plan-deposits/confirm
// Batch upsert deposits for a month; each plan's currentAmount moves by the change
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

    // Upsert each deposit and move the plan's balance by what the deposit
    // changed (new − previous). currentAmount also holds the plan's starting
    // amount, direct contributions and plan-line expenses, so it is never
    // overwritten with the sum of deposits (that wiped all of those).
    // The last entry wins when a plan appears twice.
    const byPlan = new Map(deposits.map(d => [d.planId, d]));
    await prisma.$transaction(async (tx) => {
      const previous = await tx.planDeposit.findMany({
        where: { planId: { in: [...byPlan.keys()] }, month },
        select: { planId: true, amount: true },
      });
      const before = new Map(previous.map(p => [p.planId, p.amount]));
      for (const d of byPlan.values()) {
        const amount = toCents(d.amount);
        await tx.planDeposit.upsert({
          where: { planId_month: { planId: d.planId, month } },
          update: { amount, note: d.note ?? "", byUserId: req.authUserId! },
          create: {
            userId: req.userId!,
            byUserId: req.authUserId!,
            planId: d.planId,
            month,
            amount,
            note: d.note ?? "",
          },
        });
        const delta = amount - (before.get(d.planId) ?? 0);
        if (delta !== 0) {
          await tx.lifePlan.update({ where: { id: d.planId }, data: { currentAmount: { increment: delta } } });
        }
      }
    });

    // Return updated deposits with plan info
    const updated = await prisma.planDeposit.findMany({
      where: { userId: req.userId!, month },
      include: { plan: { select: { id: true, title: true, icon: true, color: true, targetAmount: true, currentAmount: true } } },
    });

    return res.json(serializeMoney({ deposits: updated }));
  } catch (err) {
    console.error("[plan-deposits/confirm]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
