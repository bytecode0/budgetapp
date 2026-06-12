import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";

export const plansRouter = Router();

// GET /api/plans
plansRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const plans = await prisma.lifePlan.findMany({
      where: { userId: req.userId! },
      orderBy: { createdAt: "asc" },
    });
    return res.json(serializeMoney({ plans }));
  } catch (err) {
    console.error("[plans/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/plans
plansRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      title, description, goalClass, type, icon, color,
      targetAmount, currentAmount, monthlyContribution, deadline, milestones,
      autoCreateAllocation,
    } = req.body;

    if (!title || !targetAmount) {
      return res.status(400).json({ error: "Title and target amount are required" });
    }

    const parsedMonthly = toCents(monthlyContribution);

    const result = await prisma.$transaction(async (tx) => {
      const plan = await tx.lifePlan.create({
        data: {
          userId: req.userId!,
          title,
          description: description ?? "",
          goalClass: goalClass ?? "savings",
          type: type ?? "other",
          icon: icon ?? "🎯",
          color: color ?? "#1E3A8A",
          targetAmount: toCents(targetAmount),
          currentAmount: toCents(currentAmount),
          monthlyContribution: parsedMonthly,
          deadline: deadline ? new Date(deadline) : null,
          milestones: milestones ?? "[]",
        },
      });

      let allocation = null;
      if (autoCreateAllocation && parsedMonthly > 0) {
        const maxSort = await tx.allocation.aggregate({
          where: { userId: req.userId! },
          _max: { sortOrder: true },
        });
        allocation = await tx.allocation.create({
          data: {
            userId: req.userId!,
            name: title,
            icon: icon ?? "🎯",
            type: "plan",
            lifePlanId: plan.id,
            allocatedAmount: parsedMonthly,
            sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
          },
        });
      }

      return { plan, allocation };
    });

    return res.json(serializeMoney(result));
  } catch (err) {
    console.error("[plans/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/plans/monthly-status?month=YYYY-MM
// Returns contribution status for each plan that has a linked allocation
plansRouter.get("/monthly-status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: "month is required (YYYY-MM)" });
    }

    const currentMonth = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();

    // Plans that have a linked allocation
    const allocations = await prisma.allocation.findMany({
      where: { userId: req.userId!, lifePlanId: { not: null } },
      select: { lifePlanId: true, allocatedAmount: true },
    });

    if (allocations.length === 0) return res.json({ status: [] });

    const planIds = allocations.map(a => a.lifePlanId as string);
    const amountByPlanId = Object.fromEntries(allocations.map(a => [a.lifePlanId, a.allocatedAmount]));

    const [plans, deposits] = await Promise.all([
      prisma.lifePlan.findMany({
        where: { id: { in: planIds }, userId: req.userId! },
        select: { id: true, title: true, icon: true, color: true, targetAmount: true, currentAmount: true, monthlyContribution: true },
      }),
      prisma.planDeposit.findMany({
        where: { planId: { in: planIds }, userId: req.userId!, month },
      }),
    ]);

    const depositByPlanId = Object.fromEntries(deposits.map(d => [d.planId, d.amount]));

    const status = plans.map(plan => {
      const expectedAmount = amountByPlanId[plan.id] ?? plan.monthlyContribution;
      const depositedAmount = depositByPlanId[plan.id] ?? 0;
      let contributionStatus: "contributed" | "missed" | "pending";
      if (depositedAmount > 0) {
        contributionStatus = "contributed";
      } else if (month < currentMonth) {
        contributionStatus = "missed";
      } else {
        contributionStatus = "pending";
      }
      return { planId: plan.id, title: plan.title, icon: plan.icon, color: plan.color, expectedAmount, depositedAmount, status: contributionStatus };
    });

    return res.json(serializeMoney({ status }));
  } catch (err) {
    console.error("[plans/monthly-status]", err);
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
        ...(targetAmount !== undefined && { targetAmount: toCents(targetAmount) }),
        ...(currentAmount !== undefined && { currentAmount: toCents(currentAmount) }),
        ...(monthlyContribution !== undefined && { monthlyContribution: toCents(monthlyContribution) }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(milestones !== undefined && { milestones }),
      },
    });

    // Detect if linked allocation amount is out of sync with the new monthlyContribution
    let allocationOutOfSync = false;
    let linkedAllocationId: string | null = null;
    if (monthlyContribution !== undefined) {
      const linkedAlloc = await prisma.allocation.findFirst({
        where: { lifePlanId: id, userId: req.userId! },
      });
      if (linkedAlloc && linkedAlloc.allocatedAmount !== toCents(monthlyContribution)) {
        allocationOutOfSync = true;
        linkedAllocationId = linkedAlloc.id;
      }
    }

    return res.json(serializeMoney({ plan, allocationOutOfSync, linkedAllocationId }));
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
      data: { currentAmount: { increment: toCents(amount) } },
    });
    return res.json(serializeMoney({ plan }));
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

    // Unlink any allocation tied to this plan before deleting
    await prisma.allocation.updateMany({
      where: { lifePlanId: id, userId: req.userId! },
      data: { lifePlanId: null, type: "flexible" },
    });

    await prisma.lifePlan.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[plans/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
