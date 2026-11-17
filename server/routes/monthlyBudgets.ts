import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, toEuros, serializeMoney } from "../lib/money.js";
import { periodBounds, periodEnded } from "../lib/period.js";
import { ALLOCATION_NOT_FOUND, allocationsInPool, hiddenCommitted, hiddenLineIds, notOnHiddenDebt } from "../lib/poolRefs.js";
import { debtCommitments, lineBudget } from "../lib/debtBalance.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { GENEROSITY_TYPE, applyGenerosity, generosityBps, generosityForMonth, householdIncomeFor } from "../lib/generosity.js";
import { monthReview } from "../lib/monthReview.js";

export const monthlyBudgetsRouter = Router();

const ROW_ALLOCATION = { id: true, name: true, icon: true, type: true, sortOrder: true, debtId: true } as const;

/** The month's budget rows as Partidas, /review, Home and analytics read them,
 *  for the lines visible to `authUserId`, plus what the hidden ones commit
 *  (euros, as /review sums them).
 *  - Nothing saved for the month: every line at its current setting.
 *  - Saved rows: those rows, plus the lines a saved month has no row for —
 *    the Generosity line (its amount for that month) and every debt line
 *    (POST /save never stores one).
 *  A debt line's amount is lineBudget's: its commitment for THIS month, not
 *  the stored column (only refreshed when the debt itself is edited). */
async function monthBudgets(userId: string, authUserId: string, month: string) {
  const saved = await prisma.monthlyBudget.findMany({
    where: { userId, month },
    include: { allocation: { select: ROW_ALLOCATION } },
  });
  const cycleStartDay = await getCycleStartDay(userId);
  const bounds = periodBounds(month, cycleStartDay);
  const ended = periodEnded(bounds);
  const [hidden, commitments] = await Promise.all([
    hiddenLineIds(userId, authUserId),
    debtCommitments(userId, bounds),
  ]);
  const hiddenCommittedEuros = hidden.size > 0
    ? toEuros(await hiddenCommitted(userId, authUserId, commitments, { month, ended }))
    : 0;

  // If nothing saved, fall back to current allocation settings
  if (saved.length === 0) {
    // A Generosity line with a share: that share of THIS month's household
    // income (server/lib/generosity.ts). It has no debt, so it is never hidden.
    const [stored, bps] = await Promise.all([
      prisma.allocation.findMany({
        where: { userId, ...notOnHiddenDebt(authUserId) },
        orderBy: { sortOrder: "asc" },
      }),
      generosityBps(userId),
    ]);
    const allocations = applyGenerosity(stored, bps, bps === null ? 0 : await householdIncomeFor(userId, bounds));
    return {
      budgets: allocations.map(a => ({
        allocationId: a.id,
        month,
        allocatedAmount: lineBudget(a, new Map(), commitments, ended),
        allocation: { id: a.id, name: a.name, icon: a.icon, type: a.type, sortOrder: a.sortOrder },
        saved: false, // flag: not yet saved for this specific month
      })),
      hiddenCommittedEuros,
    };
  }

  const savedBy = new Map(saved.map(b => [b.allocationId, b.allocatedAmount]));
  const budgets: unknown[] = saved
    .filter(b => !hidden.has(b.allocationId))
    .map(b => ({ ...b, allocatedAmount: lineBudget({ ...b.allocation, id: b.allocationId, allocatedAmount: b.allocatedAmount }, savedBy, commitments, ended), saved: true }));

  // The lines a saved month has no row for. The Generosity line at its amount
  // for that month as the review and Home count it (the share of that month's
  // income, else the line's fixed amount); a debt line at its commitment for
  // the month. Neither the line of a debt hidden from the caller.
  const missing = await prisma.allocation.findMany({
    where: { userId, type: { in: [GENEROSITY_TYPE, "debt"] }, id: { notIn: [...savedBy.keys()] }, ...notOnHiddenDebt(authUserId) },
    select: { ...ROW_ALLOCATION, allocatedAmount: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  for (const { allocatedAmount, ...line } of missing) {
    const amount = line.type === GENEROSITY_TYPE
      ? (await generosityForMonth(userId, month, bounds)).amount
      : lineBudget({ ...line, allocatedAmount }, savedBy, commitments, ended);
    budgets.push({ allocationId: line.id, month, allocatedAmount: amount, allocation: line, saved: false });
  }
  return { budgets, hiddenCommittedEuros };
}

// GET /api/monthly-budgets?month=2026-04
// Returns budget rows for the month. If none saved yet, returns current allocation amounts.
monthlyBudgetsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month) return res.status(400).json({ error: "month is required (YYYY-MM)" });

    const { budgets, hiddenCommittedEuros } = await monthBudgets(req.userId!, req.authUserId!, month);
    return res.json({ ...serializeMoney({ budgets }), hiddenCommitted: hiddenCommittedEuros });
  } catch (err) {
    console.error("[monthly-budgets/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/monthly-budgets/save
// Upsert budget amounts for a month
monthlyBudgetsRouter.post("/save", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month, budgets } = req.body as {
      month: string;
      budgets: { allocationId: string; allocatedAmount: number }[];
    };

    if (!month || !Array.isArray(budgets)) {
      return res.status(400).json({ error: "month and budgets array are required" });
    }

    // Every line must be one of the pool's (a budget always names one).
    if (budgets.some(b => !b?.allocationId) || !(await allocationsInPool(req.userId!, req.authUserId!, budgets.map(b => b.allocationId)))) {
      return res.status(404).json(ALLOCATION_NOT_FOUND);
    }

    // A debt line's amount follows its debt (server/routes/allocations.ts):
    // amounts sent for one are ignored, never stored as the month's budget.
    const debtLines = new Set((await prisma.allocation.findMany({
      where: { userId: req.userId!, id: { in: budgets.map(b => b.allocationId) }, type: "debt" },
      select: { id: true },
    })).map(a => a.id));

    await Promise.all(
      budgets.filter(b => !debtLines.has(b.allocationId)).map(b =>
        prisma.monthlyBudget.upsert({
          where: { allocationId_month: { allocationId: b.allocationId, month } },
          update: { allocatedAmount: toCents(b.allocatedAmount) },
          create: {
            userId: req.userId!,
            allocationId: b.allocationId,
            month,
            allocatedAmount: toCents(b.allocatedAmount),
          },
        })
      )
    );

    // The month as GET answers it, so the debt and Generosity lines the save
    // stored no row for keep this month's amounts on the client.
    const { budgets: updated, hiddenCommittedEuros } = await monthBudgets(req.userId!, req.authUserId!, month);
    return res.json({ ...serializeMoney({ budgets: updated }), hiddenCommitted: hiddenCommittedEuros });
  } catch (err) {
    console.error("[monthly-budgets/save]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/monthly-budgets/review?month=2026-03
// Returns budget + actual expenses per allocation for a past month
monthlyBudgetsRouter.get("/review", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month) return res.status(400).json({ error: "month is required" });

    const { review, totalBudgeted, totalActual, unassigned, income } = await monthReview(req.userId!, month);
    // Totals over every line; the line of a debt hidden from the caller still
    // counts in them but is not listed (server/lib/poolRefs.ts).
    const hidden = await hiddenLineIds(req.userId!, req.authUserId!);

    return res.json(serializeMoney({ review: review.filter(r => !hidden.has(r.allocationId)), totalBudgeted, totalActual, unassigned, month, householdIncome: income.cents, householdIncomeSource: income.source }));
  } catch (err) {
    console.error("[monthly-budgets/review]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
