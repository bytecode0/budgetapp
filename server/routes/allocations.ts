import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { createDefaultAllocations } from "../lib/defaults.js";
import { toCents, toEuros, serializeMoney } from "../lib/money.js";
import { suggestBudgets } from "../lib/suggestBudgets.js";
import { clampCycleStartDay, currentPeriodKey, periodBounds } from "../lib/period.js";
import { debtCommitments } from "../lib/debtBalance.js";
import { incomeBaselines } from "../lib/householdIncome.js";
import { visibleToWhere } from "../lib/ownership.js";
import { hiddenCommitted, notOnHiddenDebt } from "../lib/poolRefs.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { GENEROSITY_TYPE, clearGenerosityShare, ensureGenerosityLine, isEchoedGenerosityShare, syncGenerosity } from "../lib/generosity.js";

export const allocationsRouter = Router();

// GET /api/allocations  (also returns income setting)
allocationsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Ensure defaults exist for this user
    await createDefaultAllocations(req.userId!);
    // Every budget has its Generosity line (LPBETA-10): created at 0 for
    // users from before it, and with a share set its amount follows this
    // period's household income (server/lib/generosity.ts).
    await ensureGenerosityLine(req.userId!);
    const poolCycle = await getCycleStartDay(req.userId!);
    const generosity = await syncGenerosity(req.userId!, periodBounds(currentPeriodKey(poolCycle), poolCycle));

    const [allocations, settings, baselines] = await Promise.all([
      // Not the line of a debt hidden from the caller (server/lib/poolRefs.ts).
      prisma.allocation.findMany({
        where: { userId: req.userId!, ...notOnHiddenDebt(req.authUserId!) },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.userSettings.findUnique({ where: { userId: req.userId! } }),
      incomeBaselines(req.userId!, req.authUserId!),
    ]);
    // Theme and language belong to the person, not the household pool: in a
    // couple each member keeps their own (LPBETA-27).
    const ownSettings = req.authUserId === req.userId
      ? settings
      : await prisma.userSettings.findUnique({ where: { userId: req.authUserId! } });

    // A debt line's amount depends on payments and on which period we're in
    // (a card paid in full drops to 0 the period after), so it's recomputed on
    // every read rather than trusted from the stored column.
    const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
    const period = periodBounds(currentPeriodKey(cycleStartDay), cycleStartDay);
    const commitments = await debtCommitments(req.userId!, period);
    const withDebtLines = allocations.map(a =>
      a.type === "debt" && a.debtId && commitments.has(a.debtId)
        ? { ...a, allocatedAmount: commitments.get(a.debtId)! }
        : a);

    // The lines left out above, as one figure (euros) for the client totals.
    // Never the Generosity line: it has no debt, so it is never hidden.
    const hidden = await hiddenCommitted(req.userId!, req.authUserId!, commitments);

    return res.json({
      ...serializeMoney({
        allocations: withDebtLines,
        ...baselines, // monthlyIncome (household), ownMonthlyIncome (editable), isCouple
        darkMode: ownSettings?.darkMode ?? false,
        language: ownSettings?.language ?? 'es',
        cycleStartDay: settings?.cycleStartDay ?? 1,
        generosityBps: generosity.bps, // null: the line holds a fixed amount
      }),
      hiddenCommitted: toEuros(hidden),
    });
  } catch (err) {
    console.error("[allocations/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/allocations  (create custom allocation)
allocationsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, icon, type, allocatedAmount, actualAmount, lifePlanId, debtId } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });
    // The budget's one Generosity line already exists (server/lib/generosity.ts).
    if (type === GENEROSITY_TYPE) return res.status(400).json({ error: "La línea de generosidad ya existe" });

    // Validate lifePlanId belongs to user if provided
    if (lifePlanId) {
      const plan = await prisma.lifePlan.findFirst({ where: { id: lifePlanId, userId: req.userId! } });
      if (!plan) return res.status(400).json({ error: "Life plan not found" });
    }

    // A "debt" allocation mirrors a real Debt's monthly commitment — validate
    // ownership and derive allocatedAmount from it rather than trusting the body.
    let resolvedDebtId: string | null = null;
    let debtAllocatedAmount: number | undefined;
    if (type === "debt" && debtId) {
      const debt = await prisma.debt.findFirst({ where: { id: debtId, userId: req.userId!, ...visibleToWhere(req.authUserId!) } });
      if (!debt) return res.status(400).json({ error: "Debt not found" });
      resolvedDebtId = debt.id;
      const settings = await prisma.userSettings.findUnique({ where: { userId: req.userId! }, select: { cycleStartDay: true } });
      const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
      const commitments = await debtCommitments(req.userId!, periodBounds(currentPeriodKey(cycleStartDay), cycleStartDay));
      debtAllocatedAmount = commitments.get(debt.id) ?? 0;
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
        debtId: resolvedDebtId,
        allocatedAmount: debtAllocatedAmount ?? toCents(allocatedAmount),
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
          where: { id, userId: req.userId!, ...notOnHiddenDebt(req.authUserId!) },
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

// GET /api/allocations/suggested-budgets?months=6
// Per-category budget suggestion computed from spending history (median of
// monthly totals). Includes the current allocatedAmount for an "current vs
// suggested" view. Deterministic — no AI.
allocationsRouter.get("/suggested-budgets", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const monthsParam = parseInt(String(req.query.months ?? "6"), 10);
    const months = Number.isFinite(monthsParam) ? Math.min(Math.max(monthsParam, 1), 12) : 6;

    const suggestions = await suggestBudgets(req.userId!, months);
    if (suggestions.length === 0) return res.json({ suggestions: [] });

    const allocs = await prisma.allocation.findMany({
      where: { id: { in: suggestions.map(s => s.allocationId) }, userId: req.userId!, ...notOnHiddenDebt(req.authUserId!) },
      select: { id: true, name: true, icon: true, allocatedAmount: true },
    });
    const byId = Object.fromEntries(allocs.map(a => [a.id, a]));

    // `current`/`suggested` aren't MONEY_KEYS, so convert cents → euros explicitly.
    const rows = suggestions
      .filter(s => byId[s.allocationId])
      .map(s => ({
        allocationId: s.allocationId,
        name: byId[s.allocationId].name,
        icon: byId[s.allocationId].icon,
        current: toEuros(byId[s.allocationId].allocatedAmount),
        suggested: toEuros(s.suggested),
        monthsObserved: s.monthsObserved,
        confidence: s.confidence,
      }));

    return res.json({ suggestions: rows });
  } catch (err) {
    console.error("[allocations/suggested-budgets]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/budgets
// Batch-set allocatedAmount for several allocations. Body: { budgets: [{ id, allocatedAmount }] }
// (amounts in euros). Only the user's own allocations are updated.
allocationsRouter.patch("/budgets", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const budgets = (req.body?.budgets ?? []) as { id?: string; allocatedAmount?: number }[];
    if (!Array.isArray(budgets) || budgets.length === 0) {
      return res.status(400).json({ error: "budgets are required" });
    }

    const valid = budgets.filter(
      b => typeof b.id === "string" && b.allocatedAmount != null && !isNaN(Number(b.allocatedAmount)),
    );
    if (valid.length === 0) return res.status(400).json({ error: "No valid budgets" });

    // The Generosity line is never set in batch (it is a share the user
    // chose, not a spending suggestion): it is skipped.
    const owned = await prisma.allocation.findMany({
      where: { id: { in: valid.map(b => b.id!) }, userId: req.userId!, type: { not: GENEROSITY_TYPE }, ...notOnHiddenDebt(req.authUserId!) },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map(a => a.id));

    const updated = await prisma.$transaction(
      valid
        .filter(b => ownedIds.has(b.id!))
        .map(b =>
          prisma.allocation.update({
            where: { id: b.id! },
            data: { allocatedAmount: toCents(b.allocatedAmount!) },
          }),
        ),
    );

    return res.json(serializeMoney({ updated: updated.length, allocations: updated }));
  } catch (err) {
    console.error("[allocations/budgets]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/:id
allocationsRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.allocation.findFirst({ where: { id, userId: req.userId!, ...notOnHiddenDebt(req.authUserId!) } });
    if (!existing) return res.status(404).json({ error: "Allocation not found" });

    const { name, icon, type, actualAmount, sortOrder, lifePlanId, month } = req.body;
    let { allocatedAmount } = req.body;

    // Validate lifePlanId if provided
    if (lifePlanId) {
      const plan = await prisma.lifePlan.findFirst({ where: { id: lifePlanId, userId: req.userId! } });
      if (!plan) return res.status(400).json({ error: "Life plan not found" });
    }

    // A "debt" allocation's amount is derived from the linked Debt (kept in sync
    // in server/routes/debts.ts on minimumPayment/installmentAmount changes) —
    // it isn't independently editable, to avoid it drifting from the real cuota.
    if (existing.type === "debt" && allocatedAmount !== undefined) {
      return res.status(400).json({ error: "El importe de una línea de deuda se edita desde la deuda vinculada" });
    }

    // Generosity stays a Generosity line, and no other line becomes one
    // (Método Ruta R1: it could then be deleted, or there'd be two).
    if (type !== undefined && type !== existing.type && (existing.type === GENEROSITY_TYPE || type === GENEROSITY_TYPE)) {
      return res.status(400).json({ error: "El tipo de la línea de generosidad no se puede cambiar" });
    }

    // The Generosity line with a share: its own derived amount sent back is
    // ignored; a different amount is typed by the user and replaces the share.
    let generosityTyped = false;
    if (existing.type === GENEROSITY_TYPE && allocatedAmount !== undefined) {
      const { hasShare, echoed } = await isEchoedGenerosityShare(req.userId!, toCents(allocatedAmount), typeof month === "string" ? month : undefined);
      if (echoed) allocatedAmount = undefined;
      else generosityTyped = hasShare;
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
    if (generosityTyped) await clearGenerosityShare(req.userId!);

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
    const existing = await prisma.allocation.findFirst({ where: { id, userId: req.userId!, ...notOnHiddenDebt(req.authUserId!) } });
    if (!existing) return res.status(404).json({ error: "Allocation not found" });

    // Método Ruta R1: generosity is the first line of the budget and never
    // disappears — the user can set it to 0, but the line itself is locked.
    if (existing.type === "generosity") {
      return res.status(400).json({ error: "La línea de generosidad no se puede eliminar" });
    }

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

    // The signed-in person's own row, never the household pool's (LPBETA-27).
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.authUserId! },
      update: updateData,
      create: { userId: req.authUserId!, ...updateData },
    });

    return res.json({ darkMode: settings.darkMode, language: settings.language });
  } catch (err) {
    console.error("[allocations/settings/display]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/settings/income  (update the signed-in person's own
// monthly income baseline — the body is HER figure, never the household's;
// returns both, see server/lib/householdIncome.ts)
allocationsRouter.patch("/settings/income", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { monthlyIncome } = req.body;
    if (monthlyIncome === undefined) return res.status(400).json({ error: "monthlyIncome is required" });

    await prisma.userSettings.upsert({
      where: { userId: req.authUserId! },
      update: { monthlyIncome: toCents(monthlyIncome) },
      create: { userId: req.authUserId!, monthlyIncome: toCents(monthlyIncome) },
    });

    return res.json(serializeMoney(await incomeBaselines(req.userId!, req.authUserId!)));
  } catch (err) {
    console.error("[allocations/settings/income]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/allocations/settings/payday  (update the day the budget period starts)
// 1-28; 1 = calendar month (the default — unchanged behavior for every existing user).
allocationsRouter.patch("/settings/payday", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { cycleStartDay } = req.body;
    if (cycleStartDay === undefined || isNaN(Number(cycleStartDay))) {
      return res.status(400).json({ error: "cycleStartDay is required" });
    }

    const clamped = clampCycleStartDay(Number(cycleStartDay));
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: { cycleStartDay: clamped },
      create: { userId: req.userId!, cycleStartDay: clamped },
    });

    return res.json({ cycleStartDay: settings.cycleStartDay });
  } catch (err) {
    console.error("[allocations/settings/payday]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
