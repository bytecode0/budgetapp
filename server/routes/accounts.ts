import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { createDefaultAccount } from "../lib/defaults.js";
import { toCents, serializeMoney } from "../lib/money.js";

export const accountsRouter = Router();

const ACCOUNT_TYPES = new Set(["checking", "savings", "cash", "investment", "card"]);
const VISIBILITIES = new Set(["private", "household"]);

// GET /api/accounts  — list (sorted) + net worth across non-archived accounts
accountsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await createDefaultAccount(req.userId!); // ensure at least one exists

    // Visibility (Epic H2): you always see your own accounts; you only see other
    // members' accounts when they're shared with the household (private hidden).
    const accounts = await prisma.account.findMany({
      where: {
        userId: req.userId!,
        OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    const netWorth = accounts
      .filter(a => !a.isArchived)
      .reduce((s, a) => s + a.currentBalance, 0);

    return res.json(serializeMoney({ accounts, netWorth }));
  } catch (err) {
    console.error("[accounts/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/accounts
accountsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { name, type, currency, currentBalance, visibility } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    if (type !== undefined && !ACCOUNT_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid account type" });
    }
    if (visibility !== undefined && !VISIBILITIES.has(visibility)) {
      return res.status(400).json({ error: "Invalid visibility" });
    }

    const lastOrder = await prisma.account.findFirst({
      where: { userId: req.userId! },
      orderBy: { sortOrder: "desc" },
    });

    const account = await prisma.account.create({
      data: {
        userId: req.userId!,
        ownerUserId: req.authUserId!, // the real user, even when acting on a shared pool
        householdId: req.householdId ?? null,
        name,
        type: type ?? "checking",
        currency: currency ?? "EUR",
        visibility: visibility ?? "household",
        currentBalance: toCents(currentBalance),
        sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
      },
    });

    return res.json(serializeMoney({ account }));
  } catch (err) {
    console.error("[accounts/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/accounts/reorder  — batch sortOrder (must be before /:id)
accountsRouter.patch("/reorder", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { order } = req.body as { order: { id: string; sortOrder: number }[] };
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: "order array is required" });
    }

    await prisma.$transaction(
      order.map(({ id, sortOrder }) =>
        prisma.account.updateMany({
          where: { id, userId: req.userId! },
          data: { sortOrder },
        })
      )
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[accounts/reorder]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/accounts/:id
accountsRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.account.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Account not found" });

    const { name, type, currency, currentBalance, isArchived, sortOrder, visibility, ownerUserId } = req.body;
    if (type !== undefined && !ACCOUNT_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid account type" });
    }
    if (visibility !== undefined && !VISIBILITIES.has(visibility)) {
      return res.status(400).json({ error: "Invalid visibility" });
    }
    // ownerUserId can only be reassigned to a member of the same household.
    if (ownerUserId !== undefined && req.householdId) {
      const member = await prisma.householdMember.findFirst({
        where: { householdId: req.householdId, userId: ownerUserId }, select: { id: true },
      });
      if (!member) return res.status(400).json({ error: "Owner must be a household member" });
    }

    const account = await prisma.account.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(currency !== undefined && { currency }),
        ...(currentBalance !== undefined && { currentBalance: toCents(currentBalance) }),
        ...(isArchived !== undefined && { isArchived: Boolean(isArchived) }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
        ...(visibility !== undefined && { visibility }),
        ...(ownerUserId !== undefined && { ownerUserId }),
      },
    });

    return res.json(serializeMoney({ account }));
  } catch (err) {
    console.error("[accounts/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/accounts/:id  — expenses keep their history (accountId set null)
accountsRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.account.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Account not found" });

    await prisma.account.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[accounts/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
