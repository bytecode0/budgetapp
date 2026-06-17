import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { ensureHousehold, isFinancialModel, isVisibilityTier } from "../lib/household.js";
import { computeBalances } from "../lib/balances.js";
import { serializeMoney, toEuros } from "../lib/money.js";

export const householdsRouter = Router();

// Active members of the user's household with display names.
async function activeMembers(householdId: string) {
  return prisma.householdMember.findMany({
    where: { householdId, status: "active" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
}

// Shape a household + its members for the client.
async function serializeHousehold(householdId: string) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    include: {
      members: {
        orderBy: { joinedAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
      },
    },
  });
  if (!household) return null;
  return {
    id: household.id,
    name: household.name,
    financialModel: household.financialModel,
    visibilityTier: household.visibilityTier,
    baseCurrency: household.baseCurrency,
    members: household.members.map(m => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: m.role,
      status: m.status,
      contributionBasis: m.contributionBasis,
      customSharePct: m.customSharePct,
    })),
  };
}

// GET /api/households/current — the household the user belongs to, or null.
householdsRouter.get("/current", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.householdId) return res.json({ household: null });
    return res.json({ household: await serializeHousehold(req.householdId) });
  } catch (err) {
    console.error("[households/current]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/households — create a household for the current user (owner).
// For users without a partner; links created via invite/accept auto-create one.
householdsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.householdId) return res.status(409).json({ error: "Already in a household" });
    const householdId = await ensureHousehold(req.authUserId!, undefined, "shared_stats");
    const { name } = req.body as { name?: string };
    if (name && typeof name === "string") {
      await prisma.household.update({ where: { id: householdId }, data: { name: name.slice(0, 80) } });
    }
    return res.json({ household: await serializeHousehold(householdId) });
  } catch (err) {
    console.error("[households/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/households/balances?period=YYYY-MM — who owes whom (Epic H4).
householdsRouter.get("/balances", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.householdId) return res.json({ balances: [], settlements: [] });
    const members = await activeMembers(req.householdId);
    const nameById = Object.fromEntries(members.map(m => [m.userId, m.user.name ?? m.user.email]));
    const { balances, settlements } = await computeBalances(
      req.userId!,
      members.map(m => m.userId),
      typeof req.query.period === "string" ? req.query.period : undefined,
    );
    // paid/owed/balance aren't MONEY_KEYS — convert to euros explicitly.
    return res.json({
      balances: balances.map(b => ({
        userId: b.userId,
        name: nameById[b.userId] ?? null,
        paid: toEuros(b.paid),
        owed: toEuros(b.owed),
        balance: toEuros(b.balance),
      })),
      settlements: settlements.map(s => ({
        fromUserId: s.fromUserId,
        toUserId: s.toUserId,
        fromName: nameById[s.fromUserId] ?? null,
        toName: nameById[s.toUserId] ?? null,
        amount: toEuros(s.amount),
      })),
    });
  } catch (err) {
    console.error("[households/balances]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/households/contributions — each member's income share (Epic H4).
householdsRouter.get("/contributions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.householdId) return res.json({ contributions: [] });
    const members = await activeMembers(req.householdId);
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const grouped = await prisma.income.groupBy({
      by: ["ownerUserId"],
      where: { ownerUserId: { in: members.map(m => m.userId) }, date: { gte: since } },
      _sum: { amount: true },
    });
    const incomeBy: Record<string, number> = {};
    for (const g of grouped) incomeBy[g.ownerUserId] = g._sum.amount ?? 0;
    const total = members.reduce((s, m) => s + (incomeBy[m.userId] ?? 0), 0);

    const contributions = members.map(m => ({
      userId: m.userId,
      name: m.user.name ?? m.user.email,
      income: incomeBy[m.userId] ?? 0,
      sharePct: total > 0 ? Math.round(((incomeBy[m.userId] ?? 0) / total) * 1000) / 10 : Math.round((100 / members.length) * 10) / 10,
    }));
    return res.json(serializeMoney({ contributions }));
  } catch (err) {
    console.error("[households/contributions]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/households/:id — owner updates name / model / visibility.
householdsRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const owner = await prisma.householdMember.findFirst({
      where: { householdId: id, userId: req.authUserId!, role: "owner" }, select: { id: true },
    });
    if (!owner) return res.status(403).json({ error: "Only the household owner can update it" });

    const { name, financialModel, visibilityTier } = req.body as Record<string, unknown>;
    if (financialModel !== undefined && !isFinancialModel(financialModel)) {
      return res.status(400).json({ error: "Invalid financialModel" });
    }
    if (visibilityTier !== undefined && !isVisibilityTier(visibilityTier)) {
      return res.status(400).json({ error: "Invalid visibilityTier" });
    }

    const household = await prisma.household.update({
      where: { id },
      data: {
        ...(typeof name === "string" && { name: name.slice(0, 80) }),
        ...(financialModel !== undefined && { financialModel: financialModel as string }),
        ...(visibilityTier !== undefined && { visibilityTier: visibilityTier as string }),
      },
    });
    return res.json({ household: await serializeHousehold(household.id) });
  } catch (err) {
    console.error("[households/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/households/members/:userId — set a member's contribution basis.
// Owner can edit anyone; a member can edit themselves.
householdsRouter.patch("/members/:userId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.householdId) return res.status(404).json({ error: "No household" });
    const targetUserId = req.params.userId;

    const me = await prisma.householdMember.findFirst({
      where: { householdId: req.householdId, userId: req.authUserId! }, select: { role: true },
    });
    if (!me) return res.status(403).json({ error: "Not a member" });
    if (me.role !== "owner" && targetUserId !== req.authUserId) {
      return res.status(403).json({ error: "Can only edit yourself" });
    }

    const { contributionBasis, customSharePct } = req.body as Record<string, unknown>;
    if (contributionBasis !== undefined && !["income", "equal", "custom"].includes(contributionBasis as string)) {
      return res.status(400).json({ error: "Invalid contributionBasis" });
    }

    await prisma.householdMember.updateMany({
      where: { householdId: req.householdId, userId: targetUserId },
      data: {
        ...(contributionBasis !== undefined && { contributionBasis: contributionBasis as string }),
        ...(customSharePct !== undefined && { customSharePct: customSharePct === null ? null : Number(customSharePct) }),
      },
    });
    return res.json({ household: await serializeHousehold(req.householdId) });
  } catch (err) {
    console.error("[households/members/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/households/members/:userId — leave (self) or remove (owner).
householdsRouter.delete("/members/:userId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.householdId) return res.status(404).json({ error: "No household" });
    const targetUserId = req.params.userId;

    const me = await prisma.householdMember.findFirst({
      where: { householdId: req.householdId, userId: req.authUserId! }, select: { role: true },
    });
    if (!me) return res.status(403).json({ error: "Not a member" });
    if (me.role !== "owner" && targetUserId !== req.authUserId) {
      return res.status(403).json({ error: "Only the owner can remove other members" });
    }

    await prisma.householdMember.deleteMany({
      where: { householdId: req.householdId, userId: targetUserId },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("[households/members/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
