import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { clampCycleStartDay } from "../lib/period.js";
import { loadDebtLedgers } from "../lib/debtBalance.js";
import { deriveOnboardingStatus, computeOnboardingResult } from "../lib/onboarding.js";

export const onboardingRouter = Router();

// What the user can see: their own rows plus what's shared with the household
// (same rule as GET /api/accounts and GET /api/debts).
const visibleTo = (req: AuthRequest) => ({
  userId: req.userId!,
  OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }],
});

// GET /api/onboarding/status
// Derived on every read, never a stored flag (server/lib/onboarding.ts): if
// the user later deletes something, its step comes back into the checklist.
onboardingRouter.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const [settings, incomeCount, accounts, debts, allocations] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId }, select: { monthlyIncome: true } }),
      prisma.income.count({ where: { userId } }),
      prisma.account.findMany({
        where: visibleTo(req),
        select: { type: true, name: true, currentBalance: true, isArchived: true, bankConnectionId: true },
      }),
      prisma.debt.findMany({ where: visibleTo(req), select: { kind: true } }),
      prisma.allocation.findMany({ where: { userId }, select: { type: true, allocatedAmount: true } }),
    ]);

    const status = deriveOnboardingStatus({
      monthlyIncome: settings?.monthlyIncome ?? 0,
      incomeCount,
      accounts,
      debts,
      allocations,
    });
    return res.json({ data: status });
  } catch (err) {
    console.error("[onboarding/status]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/onboarding/result
// The wizard's last step: futuro comprometido, total owed, freedom date and
// what's left after debt payments and the budget.
onboardingRouter.get("/result", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const [settings, debts, allocations] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId }, select: { monthlyIncome: true, cycleStartDay: true } }),
      prisma.debt.findMany({ where: visibleTo(req), select: { id: true, name: true, apr: true } }),
      prisma.allocation.findMany({ where: { userId }, select: { type: true, allocatedAmount: true } }),
    ]);
    const ledgers = new Map((await loadDebtLedgers(userId, debts.map(d => d.id))).map(l => [l.debt.id, l]));

    const result = computeOnboardingResult({
      debts: debts.flatMap(d => {
        const ledger = ledgers.get(d.id);
        return ledger ? [{ ledger, name: d.name, apr: d.apr }] : [];
      }),
      monthlyIncome: settings?.monthlyIncome ?? 0,
      cycleStartDay: clampCycleStartDay(settings?.cycleStartDay ?? 1),
      allocations,
    });
    return res.json({ data: serializeMoney(result) });
  } catch (err) {
    console.error("[onboarding/result]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
