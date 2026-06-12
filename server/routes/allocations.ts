import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { createDefaultAllocations } from "../lib/defaults.js";
import { toCents, serializeMoney } from "../lib/money.js";

export const allocationsRouter = Router();

// GET /api/allocations  (also returns income setting)
allocationsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Ensure defaults exist for this user
    await createDefaultAllocations(req.userId!);

    const [allocations, settings] = await Promise.all([
      prisma.allocation.findMany({
        where: { userId: req.userId! },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.userSettings.findUnique({ where: { userId: req.userId! } }),
    ]);

    return res.json(serializeMoney({
      allocations,
      monthlyIncome: settings?.monthlyIncome ?? 0,
      darkMode: settings?.darkMode ?? false,
      language: settings?.language ?? 'en',
    }));
  } catch (err) {
    console.error("[allocations/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/allocations  (create custom allocation)
allocationsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, icon, type, allocatedAmount, actualAmount, lifePlanId } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });

    // Validate lifePlanId belongs to user if provided
    if (lifePlanId) {
      const plan = await prisma.lifePlan.findFirst({ where: { id: lifePlanId, userId: req.userId! } });
      if (!plan) return res.status(400).json({ error: "Life plan not found" });
    }

    const lastOrder = await prisma.allocation.findFirst({
      where: { userId: req.userId! },
      orderBy: { sortOrder: "desc" },
    });

    const allocation = await prisma.allocation.create({
      data: {
        userId: req.userId!,
        name,
        icon: icon ?? "💰",
        type: type ?? "flexible",
        lifePlanId: (type === "plan" && lifePlanId) ? lifePlanId : null,
        allocatedAmount: toCents(allocatedAmount),
        actualAmount: toCents(actualAmount),
        sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
        isDefault: false,
      },
    });

    return res.json(serializeMoney({ allocation }));
  } catch (err) {
    console.error("[allocations/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/reorder  — batch update sortOrder (must be before /:id)
allocationsRouter.patch("/reorder", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { order } = req.body as { order: { id: string; sortOrder: number }[] };
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: "order array is required" });
    }

    await prisma.$transaction(
      order.map(({ id, sortOrder }) =>
        prisma.allocation.updateMany({
          where: { id, userId: req.userId! },
          data: { sortOrder },
        })
      )
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[allocations/reorder]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/:id
allocationsRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.allocation.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Allocation not found" });

    const { name, icon, type, allocatedAmount, actualAmount, sortOrder, lifePlanId } = req.body;

    // Validate lifePlanId if provided
    if (lifePlanId) {
      const plan = await prisma.lifePlan.findFirst({ where: { id: lifePlanId, userId: req.userId! } });
      if (!plan) return res.status(400).json({ error: "Life plan not found" });
    }

    const newType = type ?? existing.type;
    const allocation = await prisma.allocation.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(icon !== undefined && { icon }),
        ...(type !== undefined && { type }),
        // If type changes away from plan or lifePlanId explicitly set to null, clear the link
        ...(lifePlanId !== undefined
          ? { lifePlanId: (newType === 'plan' && lifePlanId) ? lifePlanId : null }
          : type === 'plan' ? {} : type !== undefined ? { lifePlanId: null } : {}
        ),
        ...(allocatedAmount !== undefined && { allocatedAmount: toCents(allocatedAmount) }),
        ...(actualAmount !== undefined && { actualAmount: toCents(actualAmount) }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
      },
    });

    return res.json(serializeMoney({ allocation }));
  } catch (err) {
    console.error("[allocations/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/allocations/:id
allocationsRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.allocation.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Allocation not found" });

    await prisma.allocation.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[allocations/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/settings/display  (update display preferences)
allocationsRouter.patch("/settings/display", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { darkMode, language } = req.body;
    if (darkMode === undefined && language === undefined) {
      return res.status(400).json({ error: "darkMode or language is required" });
    }

    const updateData: Record<string, any> = {};
    if (darkMode !== undefined) updateData.darkMode = Boolean(darkMode);
    if (language !== undefined) updateData.language = String(language);

    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: updateData,
      create: { userId: req.userId!, ...updateData },
    });

    return res.json({ darkMode: settings.darkMode, language: settings.language });
  } catch (err) {
    console.error("[allocations/settings/display]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/settings/income  (update monthly income)
allocationsRouter.patch("/settings/income", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { monthlyIncome } = req.body;
    if (monthlyIncome === undefined) return res.status(400).json({ error: "monthlyIncome is required" });

    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: { monthlyIncome: toCents(monthlyIncome) },
      create: { userId: req.userId!, monthlyIncome: toCents(monthlyIncome) },
    });

    return res.json(serializeMoney({ monthlyIncome: settings.monthlyIncome }));
  } catch (err) {
    console.error("[allocations/settings/income]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
