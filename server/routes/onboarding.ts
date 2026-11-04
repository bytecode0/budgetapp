import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { clampCycleStartDay, currentPeriodKey, periodBounds } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { loadDebtLedgers } from "../lib/debtBalance.js";
import { deriveOnboardingStatus, computeOnboardingResult, parseOnboardingGoal } from "../lib/onboarding.js";
import { pctToBps } from "../../shared/incomeShare.js";
import { ensureGenerosityLine, householdIncomeFor, syncGenerosity } from "../lib/generosity.js";
import { householdBaselineIncome } from "../lib/householdIncome.js";

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
    const [monthlyIncome, settings, incomeCount, accounts, debts, allocations] = await Promise.all([
      householdBaselineIncome(userId),
      prisma.userSettings.findUnique({ where: { userId }, select: { noCardsAt: true, noLoansAt: true, onboardingGoal: true } }),
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
      monthlyIncome,
      incomeCount,
      accounts,
      debts,
      allocations,
      noCards: settings?.noCardsAt != null,
      noLoans: settings?.noLoansAt != null,
      goal: settings?.onboardingGoal ?? null,
    });
    return res.json({ data: status });
  } catch (err) {
    console.error("[onboarding/status]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/onboarding/answers  { noCards?: boolean, noLoans?: boolean, goal?: string | null }
// "I have no credit cards" / "I have no loans": marks that setup step done.
// false undoes the answer. `goal` is the opening question (LPBETA-07; one of
// ONBOARDING_GOALS, null clears it). Stored on the pool's settings, like the income.
onboardingRouter.patch("/answers", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { noCards, noLoans, goal } = req.body ?? {};
    if (noCards === undefined && noLoans === undefined && goal === undefined) {
      return res.status(400).json({ error: "noCards, noLoans or goal is required" });
    }
    if ((noCards !== undefined && typeof noCards !== "boolean") || (noLoans !== undefined && typeof noLoans !== "boolean")) {
      return res.status(400).json({ error: "noCards and noLoans must be booleans" });
    }
    if (goal !== undefined && goal !== null && parseOnboardingGoal(goal) === null) {
      return res.status(400).json({ error: "Unknown goal" });
    }
    const now = new Date();
    const data: { noCardsAt?: Date | null; noLoansAt?: Date | null; onboardingGoal?: string | null } = {};
    if (noCards !== undefined) data.noCardsAt = noCards ? now : null;
    if (noLoans !== undefined) data.noLoansAt = noLoans ? now : null;
    if (goal !== undefined) data.onboardingGoal = parseOnboardingGoal(goal);

    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: data,
      create: { userId: req.userId!, ...data },
      select: { noCardsAt: true, noLoansAt: true, onboardingGoal: true },
    });
    return res.json({ data: {
      noCards: settings.noCardsAt != null,
      noLoans: settings.noLoansAt != null,
      goal: parseOnboardingGoal(settings.onboardingGoal),
    } });
  } catch (err) {
    console.error("[onboarding/answers]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/onboarding/preferences  { payYourselfFirstPct?: number | null, generosityPct?: number }
// Shares of the household's income the user chose, on the pool's settings
// (they are measured against the household's income):
// - payYourselfFirstPct: "Págate a ti primero" (0–100 %, null = not chosen).
// - generosityPct: the Generosity line (0–100 %; "ahora no" = 0). Its line is
//   created if missing and its amount set from this period's income; later it
//   follows the income with the same % (server/lib/generosity.ts).
onboardingRouter.patch("/preferences", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { payYourselfFirstPct, generosityPct } = req.body ?? {};
    if (payYourselfFirstPct === undefined && generosityPct === undefined) {
      return res.status(400).json({ error: "payYourselfFirstPct or generosityPct is required" });
    }
    const data: { payYourselfFirstBps?: number | null; payYourselfFirstSetAt?: Date | null; generosityBps?: number } = {};
    if (payYourselfFirstPct !== undefined) {
      const bps = payYourselfFirstPct === null ? null : pctToBps(payYourselfFirstPct);
      if (payYourselfFirstPct !== null && bps === null) {
        return res.status(400).json({ error: "payYourselfFirstPct must be between 0 and 100" });
      }
      data.payYourselfFirstBps = bps;
      // Months that ended before the share was chosen (or changed) are not
      // judged by it. Saving the same share again keeps the date.
      const current = await prisma.userSettings.findUnique({ where: { userId: req.userId! }, select: { payYourselfFirstBps: true } });
      if (bps === null) data.payYourselfFirstSetAt = null;
      else if (current?.payYourselfFirstBps !== bps) data.payYourselfFirstSetAt = new Date();
    }
    if (generosityPct !== undefined) {
      const bps = pctToBps(generosityPct);
      if (bps === null) return res.status(400).json({ error: "generosityPct must be between 0 and 100" });
      data.generosityBps = bps;
    }
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.userId! },
      update: data,
      create: { userId: req.userId!, ...data },
      select: { payYourselfFirstBps: true, generosityBps: true, cycleStartDay: true },
    });
    let generosityAmount: number | undefined;
    if (data.generosityBps !== undefined) {
      await ensureGenerosityLine(req.userId!);
      const cycle = clampCycleStartDay(settings.cycleStartDay);
      generosityAmount = (await syncGenerosity(req.userId!, periodBounds(currentPeriodKey(cycle), cycle))).amount;
    }
    return res.json({ data: serializeMoney({
      payYourselfFirstBps: settings.payYourselfFirstBps,
      generosityBps: settings.generosityBps,
      ...(generosityAmount !== undefined && { generosityAmount }),
    }) });
  } catch (err) {
    console.error("[onboarding/preferences]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/onboarding/result
// The wizard's last step: what's left after debt payments and the budget (what
// you could save), the futuro comprometido as one more figure, the debt
// payoff when there is consumer debt, and the first goals' inputs: the
// suggested emergency fund, what's already saved, the chosen share.
onboardingRouter.get("/result", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    // The Generosity line's amount for this period first (it may follow the income).
    const cycle = await getCycleStartDay(userId);
    const generosity = await syncGenerosity(userId, periodBounds(currentPeriodKey(cycle), cycle));
    // The household's income for this period as Home counts it (recorded
    // when any, else the baseline) — the same figure the Generosity share and
    // "Págate a ti primero" are measured against, so every number agrees.
    const [settings, monthlyIncome, debts, allocations, savingsAccounts, emergencyPlans] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId }, select: { cycleStartDay: true, payYourselfFirstBps: true, onboardingGoal: true } }),
      householdIncomeFor(userId, periodBounds(currentPeriodKey(cycle), cycle)),
      prisma.debt.findMany({ where: visibleTo(req), select: { id: true, name: true, apr: true } }),
      prisma.allocation.findMany({ where: { userId }, select: { type: true, allocatedAmount: true } }),
      // What the savings step recorded (SavingsStep: a cash/savings account).
      prisma.account.findMany({
        where: { ...visibleTo(req), isArchived: false, type: { in: ["cash", "savings"] } },
        select: { currentBalance: true },
      }),
      prisma.lifePlan.count({ where: { userId, type: "emergency" } }),
    ]);
    const ledgers = new Map((await loadDebtLedgers(userId, debts.map(d => d.id))).map(l => [l.debt.id, l]));

    const result = computeOnboardingResult({
      debts: debts.flatMap(d => {
        const ledger = ledgers.get(d.id);
        return ledger ? [{ ledger, name: d.name, apr: d.apr }] : [];
      }),
      monthlyIncome,
      cycleStartDay: clampCycleStartDay(settings?.cycleStartDay ?? 1),
      allocations,
      savedSoFar: savingsAccounts.reduce((s, a) => s + Math.max(0, a.currentBalance), 0),
      hasEmergencyPlan: emergencyPlans > 0,
      payYourselfFirstBps: settings?.payYourselfFirstBps ?? null,
      goal: parseOnboardingGoal(settings?.onboardingGoal),
    });
    return res.json({ data: serializeMoney({ ...result, generosityAmount: generosity.amount, generosityBps: generosity.bps }) });
  } catch (err) {
    console.error("[onboarding/result]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
