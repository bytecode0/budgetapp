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
// Derived on every read (server/lib/onboarding.ts): if the user later deletes
// something, its step comes back into the checklist. The only stored inputs
// are the "no cards" / "no loans" answers (PATCH /api/onboarding/answers).
onboardingRouter.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const [settings, incomeCount, accounts, debts, allocations] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId }, select: { monthlyIncome: true, noCardsAt: true, noLoansAt: true } }),
      prisma.income.count({ where: { userId } }),
      prisma.account.findMany({
        where: visibleTo(req),
        select: { id: true, ownerUserId: true, type: true, name: true, currentBalance: true, isArchived: true, bankConnectionId: true },
      }),
      prisma.debt.findMany({ where: visibleTo(req), select: { kind: true, status: true } }),
      prisma.allocation.findMany({ where: { userId }, select: { type: true, allocatedAmount: true } }),
    ]);

    const status = deriveOnboardingStatus({
      authUserId: req.authUserId!,
      monthlyIncome: settings?.monthlyIncome ?? 0,
      incomeCount,
      accounts,
      debts,
      allocations,
      noCards: settings?.noCardsAt != null,
      noLoans: settings?.noLoansAt != null,
    });
    return res.json({ data: status });
  } catch (err) {
    console.error("[onboarding/status]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/onboarding/answers  { noCards?: boolean, noLoans?: boolean }
// "I have no credit cards" / "I have no loans": marks that setup step done.
// false undoes the answer. Stored on the pool's settings, like the income.
onboardingRouter.patch("/answers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { noCards, noLoans } = req.body ?? {};
    if (noCards === undefined && noLoans === undefined) {
      return res.status(400).json({ error: "noCards or noLoans is required" });
    }
    if ((noCards !== undefined && typeof noCards !== "boolean") || (noLoans !== undefined && typeof noLoans !== "boolean")) {
      return res.status(400).json({ error: "noCards and noLoans must be booleans" });
    }
    const now = new Date();
    const data: { noCardsAt?: Date | null; noLoansAt?: Date | null } = {};
    if (noCards !== undefined) data.noCardsAt = noCards ? now : null;
    if (noLoans !== undefined) data.noLoansAt = noLoans ? now : null;

    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: data,
      create: { userId: req.userId!, ...data },
      select: { noCardsAt: true, noLoansAt: true },
    });
    return res.json({ data: { noCards: settings.noCardsAt != null, noLoans: settings.noLoansAt != null } });
  } catch (err) {
    console.error("[onboarding/answers]", err);
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
