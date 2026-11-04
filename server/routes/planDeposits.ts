import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { periodBounds } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { loadBookedByPlan, planMonthContribution } from "../lib/payYourselfFirst.js";

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
// Batch upsert deposits for a month (each the month's total for its plan); each
// plan's currentAmount moves by the change in its month contribution
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

    // Upsert each deposit and move the plan's balance by what the month's
    // contribution changed. A month's contribution is max(deposit, booked on
    // the plan's line) (server/lib/payYourselfFirst.ts): booked money is
    // already in currentAmount (the expense routes add it), so the deposit
    // adds only what goes beyond it. currentAmount also holds the plan's
    // starting amount and direct contributions, so it is never overwritten.
    // The last entry wins when a plan appears twice.
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month must be YYYY-MM" });
    const byPlan = new Map(deposits.map(d => [d.planId, d]));
    const bounds = periodBounds(month, await getCycleStartDay(req.userId!));
    await prisma.$transaction(async (tx) => {
      // Lock the plans (in a fixed order) before reading their deposits, so
      // concurrent confirms of the same plan apply their change one at a time.
      for (const planId of [...byPlan.keys()].sort()) {
        await tx.$queryRaw`SELECT id FROM "LifePlan" WHERE id = ${planId} FOR UPDATE`;
      }
      const [previous, booked] = await Promise.all([
        tx.planDeposit.findMany({ where: { planId: { in: [...byPlan.keys()] }, month }, select: { planId: true, amount: true } }),
        loadBookedByPlan(tx, req.userId!, bounds, [...byPlan.keys()]),
      ]);
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
        const onLine = booked.get(d.planId) ?? 0;
        const delta = planMonthContribution(amount, onLine) - planMonthContribution(before.get(d.planId) ?? 0, onLine);
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
