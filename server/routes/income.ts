import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { normalizeMerchant } from "../lib/normalizeMerchant.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { incomeListingFilter } from "../lib/visibility.js";

export const incomeRouter = Router();

const CATEGORIES = new Set(["salary", "freelance", "transfer_in", "other"]);

// Validate a requested accountId belongs to the user; null when not owned/none.
async function ownedAccountId(userId: string, accountId?: string | null): Promise<string | null> {
  if (!accountId) return null;
  const owned = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true },
  });
  return owned?.id ?? null;
}

// GET /api/income?month=2026-04&accountId=xxx
incomeRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month, accountId } = req.query as Record<string, string>;
    const where: any = { userId: req.userId! };

    if (month) {
      const [year, mon] = month.split("-").map(Number);
      where.date = { gte: new Date(year, mon - 1, 1), lt: new Date(year, mon, 1) };
    }
    if (accountId) where.accountId = accountId;

    // Visibility (Epic H5): at shared_stats, show only the viewer's own income.
    Object.assign(where, await incomeListingFilter(req));

    const incomes = await prisma.income.findMany({
      where,
      include: { account: { select: { id: true, name: true, type: true } } },
      orderBy: { date: "desc" },
    });

    return res.json(serializeMoney({ incomes }));
  } catch (err) {
    console.error("[income/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/income
incomeRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { amount, description, category, accountId, date } = req.body;

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: "Valid amount is required" });
    }
    if (category !== undefined && !CATEGORIES.has(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }

    const income = await prisma.income.create({
      data: {
        userId: req.userId!,
        ownerUserId: req.authUserId!,
        amount: toCents(amount),
        description: description ?? "",
        merchant: normalizeMerchant(description),
        category: category ?? "salary",
        source: "manual",
        accountId: await ownedAccountId(req.userId!, accountId),
        date: date ? new Date(date) : new Date(),
      },
      include: { account: { select: { id: true, name: true, type: true } } },
    });

    return res.json(serializeMoney({ income }));
  } catch (err) {
    console.error("[income/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/income/:id
incomeRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.income.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Income not found" });

    const { amount, description, category, accountId, date } = req.body;
    if (category !== undefined && !CATEGORIES.has(category)) {
      return res.status(400).json({ error: "Invalid category" });
    }

    // Only override the account when a (valid, owned) id is supplied.
    let accountUpdate: { accountId: string } | undefined;
    if (accountId !== undefined && accountId) {
      const owned = await ownedAccountId(req.userId!, accountId);
      if (owned) accountUpdate = { accountId: owned };
    }

    const income = await prisma.income.update({
      where: { id },
      data: {
        ...(amount !== undefined && { amount: toCents(amount) }),
        ...(description !== undefined && { description, merchant: normalizeMerchant(description) }),
        ...(category !== undefined && { category }),
        ...(accountUpdate ?? {}),
        ...(date !== undefined && { date: new Date(date) }),
      },
      include: { account: { select: { id: true, name: true, type: true } } },
    });

    return res.json(serializeMoney({ income }));
  } catch (err) {
    console.error("[income/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/income/:id
incomeRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.income.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Income not found" });

    await prisma.income.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[income/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
