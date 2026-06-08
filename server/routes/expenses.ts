import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { normalizeMerchant } from "../lib/normalizeMerchant.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { categorize, learnFromCorrection } from "../lib/categorize.js";
import { findDuplicateGroups } from "../lib/dedupe.js";

export const expensesRouter = Router();

// Validate a requested accountId belongs to the user; if none given, fall back
// to the user's default account (lowest sortOrder, non-archived). Returns null
// only when the user has no accounts at all.
async function resolveAccountId(userId: string, accountId?: string | null): Promise<string | null> {
  if (accountId) {
    const owned = await prisma.account.findFirst({
      where: { id: accountId, userId },
      select: { id: true },
    });
    if (owned) return owned.id;
  }
  const fallback = await prisma.account.findFirst({
    where: { userId, isArchived: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

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
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true } },
        account: { select: { id: true, name: true, type: true } },
      },
      orderBy: { date: "desc" },
    });

    return res.json(serializeMoney({ expenses }));
  } catch (err) {
    console.error("[expenses/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses
expensesRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, description, allocationId, accountId, date } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }

    const amountCents = toCents(amount);
    const merchant = normalizeMerchant(description);

    // Auto-categorize: when the user didn't pick an allocation, let the rules decide.
    let resolvedAllocationId: string | null = allocationId || null;
    if (!resolvedAllocationId) {
      resolvedAllocationId = await categorize(req.userId!, description ?? "", merchant);
    }

    // Resolve the account: validate ownership if given, else fall back to the
    // user's default (lowest sortOrder, non-archived) account.
    const resolvedAccountId = await resolveAccountId(req.userId!, accountId);

    const expense = await prisma.expense.create({
      data: {
        userId: req.userId!,
        amount: amountCents,
        description: description ?? "",
        merchant,
        source: "manual",
        allocationId: resolvedAllocationId,
        accountId: resolvedAccountId,
        date: date ? new Date(date) : new Date(),
      },
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true, lifePlanId: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });

    // Auto-contribute to linked life plan if this is a plan allocation
    if (expense.allocation?.type === "plan" && expense.allocation.lifePlanId) {
      await prisma.lifePlan.update({
        where: { id: expense.allocation.lifePlanId },
        data: { currentAmount: { increment: amountCents } },
      });
    }

    return res.json(serializeMoney({ expense }));
  } catch (err) {
    console.error("[expenses/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/expenses/duplicates  — groups of likely duplicate expenses
expensesRouter.get("/duplicates", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { userId: req.userId! },
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true } },
        account: { select: { id: true, name: true, type: true } },
      },
      orderBy: { date: "desc" },
    });

    const groups = findDuplicateGroups(expenses);
    return res.json(serializeMoney({ groups }));
  } catch (err) {
    console.error("[expenses/duplicates]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/expenses/merge  — keep one expense, delete the duplicates
// Body: { keepId, removeIds: string[] }
expensesRouter.post("/merge", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { keepId, removeIds } = req.body as { keepId: string; removeIds: string[] };
    if (!keepId || !Array.isArray(removeIds) || removeIds.length === 0) {
      return res.status(400).json({ error: "keepId and removeIds are required" });
    }
    if (removeIds.includes(keepId)) {
      return res.status(400).json({ error: "keepId cannot be in removeIds" });
    }

    // Only operate on the user's own expenses.
    const toRemove = await prisma.expense.findMany({
      where: { id: { in: removeIds }, userId: req.userId! },
      include: { allocation: { select: { type: true, lifePlanId: true } } },
    });
    const keep = await prisma.expense.findFirst({ where: { id: keepId, userId: req.userId! } });
    if (!keep) return res.status(404).json({ error: "Expense to keep not found" });

    // Reverse any plan contributions before deleting, mirroring DELETE /:id.
    for (const e of toRemove) {
      if (e.allocation?.type === "plan" && e.allocation.lifePlanId) {
        await prisma.lifePlan.update({
          where: { id: e.allocation.lifePlanId },
          data: { currentAmount: { decrement: e.amount } },
        });
      }
    }
    await prisma.expense.deleteMany({ where: { id: { in: toRemove.map(e => e.id) }, userId: req.userId! } });

    return res.json({ success: true, removed: toRemove.length });
  } catch (err) {
    console.error("[expenses/merge]", err);
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

    const { amount, description, allocationId, accountId, date } = req.body;

    // Validate a re-assigned account belongs to the user (ignore invalid ids).
    let accountUpdate: { accountId: string } | undefined;
    if (accountId !== undefined && accountId) {
      const owned = await prisma.account.findFirst({
        where: { id: accountId, userId: req.userId! },
        select: { id: true },
      });
      if (owned) accountUpdate = { accountId: owned.id };
    }

    // Resolve the allocation that will apply after the update
    const newAllocId = allocationId !== undefined ? (allocationId || null) : existing.allocationId;
    const newAlloc = newAllocId ? await prisma.allocation.findFirst({
      where: { id: newAllocId },
      select: { type: true, lifePlanId: true },
    }) : null;
    const newAmount = amount !== undefined ? toCents(amount) : existing.amount;

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
        ...(description !== undefined && { description, merchant: normalizeMerchant(description) }),
        ...(allocationId !== undefined && { allocationId: allocationId || null }),
        ...(accountUpdate ?? {}),
        ...(date !== undefined && { date: new Date(date) }),
      },
      include: {
        allocation: { select: { id: true, name: true, icon: true, type: true, lifePlanId: true } },
        account: { select: { id: true, name: true, type: true } },
      },
    });

    // Learn from manual re-assignment: when the user moves an expense to a (real)
    // allocation, remember the merchant -> allocation mapping for next time.
    if (allocationId !== undefined && newAllocId && newAllocId !== existing.allocationId) {
      const effectiveMerchant = description !== undefined ? normalizeMerchant(description) : existing.merchant;
      await learnFromCorrection(req.userId!, effectiveMerchant, newAllocId);
    }

    return res.json(serializeMoney({ expense }));
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
