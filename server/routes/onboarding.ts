import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";

export const onboardingRouter = Router();

// GET /api/onboarding/status
// "Needs onboarding" is a derived state, never a persisted flag: if the user
// later deletes their income/debts/budget, this must go back to true so the
// onboarding wizard reappears, per the product rule ("always show it while
// nothing is configured yet").
onboardingRouter.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const [settings, incomeCount, debtCount, allocations] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId }, select: { monthlyIncome: true } }),
      prisma.income.count({ where: { userId } }),
      prisma.debt.count({ where: { userId } }),
      prisma.allocation.findMany({ where: { userId }, select: { allocatedAmount: true } }),
    ]);

    const hasIncome = (settings?.monthlyIncome ?? 0) > 0 || incomeCount > 0;
    const hasDebts = debtCount > 0;
    const hasBudget = allocations.some(a => a.allocatedAmount > 0);

    const needsOnboarding = !hasIncome && !hasDebts && !hasBudget;

    return res.json({ needsOnboarding, hasIncome, hasDebts, hasBudget });
  } catch (err) {
    console.error("[onboarding/status]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
