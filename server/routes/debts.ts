import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { buildDebtTimeline } from "../lib/debtTimeline.js";
import { simulatePayoff, type PayoffMethod } from "../lib/debtPayoff.js";
import { clampCycleStartDay } from "../lib/period.js";

export const debtsRouter = Router();

const DEBT_KINDS = new Set(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "student_loan", "mortgage", "other"]);
const DEBT_STATUSES = new Set(["active", "paid_off", "archived"]);
const VISIBILITIES = new Set(["private", "household"]);

// Método Ruta R3: the debt frontier is by TYPE of debt, never by interest rate.
// Consumer/depreciating-asset debt (R3.1) is always inadmissible and always the
// snowball's attack target — an existing student loan isn't asset-backed, so it
// sits here too. "mortgage" (R3.2, appreciating/producing asset) and "other"
// (unclassified) sit outside the attack list — see scope=consumer below.
const CONSUMER_DEBT_KINDS = new Set(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "student_loan"]);

function clampDay(n: unknown): number | null {
  const v = parseInt(String(n), 10);
  if (!Number.isFinite(v)) return null;
  return Math.min(28, Math.max(1, v));
}

// GET /api/debts  — list (sorted), visible ones only (own + household-shared)
debtsRouter.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const debts = await prisma.debt.findMany({
      where: {
        userId: req.userId!,
        OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }],
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    const active = debts.filter(d => d.status === "active");
    const totalOwed = active.reduce((s, d) => s + d.currentBalance, 0);
    const totalMinimums = active.reduce((s, d) => s + (d.minimumPayment ?? d.installmentAmount ?? 0), 0);

    return res.json(serializeMoney({ debts, totalOwed, totalMinimums }));
  } catch (err) {
    console.error("[debts/GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/debts/timeline?periods=6  (must be before /:id-style routes — though
// none exist on GET today, keep it grouped with the other fixed sub-routes)
// The "committed future": for each upcoming period, how much is already owed
// in minimums/installments, and what % of expected income that represents.
debtsRouter.get("/timeline", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const periodsCount = Math.min(24, Math.max(1, parseInt(String(req.query.periods ?? "6"), 10) || 6));

    const [debts, settings] = await Promise.all([
      prisma.debt.findMany({
        where: { userId: req.userId!, OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }] },
        select: { id: true, name: true, kind: true, status: true, minimumPayment: true, installmentAmount: true, installmentsTotal: true, installmentsPaid: true },
      }),
      prisma.userSettings.findUnique({ where: { userId: req.userId! }, select: { cycleStartDay: true, monthlyIncome: true } }),
    ]);

    const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
    const timeline = buildDebtTimeline(debts, settings?.monthlyIncome ?? 0, cycleStartDay, periodsCount);

    return res.json(serializeMoney({ timeline }));
  } catch (err) {
    console.error("[debts/timeline]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/debts/payoff?extra=50  — snowball vs avalanche comparison for the
// user's active debts, with an optional extra monthly payment (euros).
// ?scope=consumer restricts the simulation to R3.1 kinds only (Método Ruta):
// a mortgage sitting in the same cascade would push "months to zero" out by
// decades, when R4.4-R4.6 only care about consumer debt reaching zero.
debtsRouter.get("/payoff", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    // Express types a query param as string | string[] | ParsedQs — only a plain
    // string is a meaningful amount here (same narrowing as /banking/institutions).
    const extraPaymentCents = toCents(typeof req.query.extra === "string" ? req.query.extra : 0);
    const scope = typeof req.query.scope === "string" ? req.query.scope : undefined;

    const debts = await prisma.debt.findMany({
      where: {
        userId: req.userId!, status: "active",
        OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }],
        ...(scope === "consumer" && { kind: { in: [...CONSUMER_DEBT_KINDS] } }),
      },
      select: { id: true, name: true, currentBalance: true, apr: true, minimumPayment: true, installmentAmount: true },
    });

    if (debts.length === 0) return res.json({ snowball: null, avalanche: null });

    const nameById = Object.fromEntries(debts.map(d => [d.id, d.name]));
    const withNames = (r: ReturnType<typeof simulatePayoff>) => ({
      ...r,
      payoffOrder: r.payoffOrder.map(p => ({ ...p, name: nameById[p.id] ?? null })),
    });

    const methods: PayoffMethod[] = ["snowball", "avalanche"];
    const [snowball, avalanche] = methods.map(m => withNames(simulatePayoff(debts, m, extraPaymentCents)));

    return res.json(serializeMoney({ snowball, avalanche }));
  } catch (err) {
    console.error("[debts/payoff]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/debts
debtsRouter.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const {
      name, kind, accountId, currentBalance, principal, apr,
      creditLimit, statementDay, paymentDueDay, minimumPayment,
      installmentAmount, installmentsTotal, installmentsPaid, startDate, endDate,
      visibility,
    } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (kind !== undefined && !DEBT_KINDS.has(kind)) {
      return res.status(400).json({ error: "Invalid debt kind" });
    }
    if (visibility !== undefined && !VISIBILITIES.has(visibility)) {
      return res.status(400).json({ error: "Invalid visibility" });
    }

    // A linked account must belong to the user.
    let resolvedAccountId: string | null = null;
    if (accountId) {
      const owned = await prisma.account.findFirst({ where: { id: accountId, userId: req.userId! }, select: { id: true } });
      if (owned) resolvedAccountId = owned.id;
    }

    const lastOrder = await prisma.debt.findFirst({
      where: { userId: req.userId! },
      orderBy: { sortOrder: "desc" },
    });

    const debt = await prisma.debt.create({
      data: {
        userId: req.userId!,
        ownerUserId: req.authUserId!,
        householdId: req.householdId ?? null,
        visibility: visibility ?? "household",
        name,
        kind: kind ?? "other",
        accountId: resolvedAccountId,
        currentBalance: toCents(currentBalance),
        principal: principal !== undefined ? toCents(principal) : null,
        apr: apr !== undefined && apr !== null ? Number(apr) : null,
        creditLimit: creditLimit !== undefined ? toCents(creditLimit) : null,
        statementDay: statementDay !== undefined ? clampDay(statementDay) : null,
        paymentDueDay: paymentDueDay !== undefined ? clampDay(paymentDueDay) : null,
        minimumPayment: minimumPayment !== undefined ? toCents(minimumPayment) : null,
        installmentAmount: installmentAmount !== undefined ? toCents(installmentAmount) : null,
        installmentsTotal: installmentsTotal !== undefined ? parseInt(installmentsTotal, 10) || null : null,
        installmentsPaid: installmentsPaid !== undefined ? parseInt(installmentsPaid, 10) || 0 : 0,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
      },
    });

    return res.json(serializeMoney({ debt }));
  } catch (err) {
    console.error("[debts/POST]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/debts/reorder  (must be before /:id)
debtsRouter.patch("/reorder", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { order } = req.body as { order: { id: string; sortOrder: number }[] };
    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ error: "order array is required" });
    }

    await prisma.$transaction(
      order.map(({ id, sortOrder }) =>
        prisma.debt.updateMany({ where: { id, userId: req.userId! }, data: { sortOrder } })
      )
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("[debts/reorder]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/debts/:id
debtsRouter.patch("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.debt.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Debt not found" });

    const {
      name, kind, status, accountId, currentBalance, principal, apr,
      creditLimit, statementDay, paymentDueDay, minimumPayment,
      installmentAmount, installmentsTotal, installmentsPaid, startDate, endDate,
      visibility, sortOrder,
    } = req.body;

    if (kind !== undefined && !DEBT_KINDS.has(kind)) return res.status(400).json({ error: "Invalid debt kind" });
    if (status !== undefined && !DEBT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid status" });
    if (visibility !== undefined && !VISIBILITIES.has(visibility)) return res.status(400).json({ error: "Invalid visibility" });

    let accountUpdate: { accountId: string | null } | undefined;
    if (accountId !== undefined) {
      if (!accountId) {
        accountUpdate = { accountId: null };
      } else {
        const owned = await prisma.account.findFirst({ where: { id: accountId, userId: req.userId! }, select: { id: true } });
        if (owned) accountUpdate = { accountId: owned.id };
      }
    }

    const debt = await prisma.debt.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(kind !== undefined && { kind }),
        ...(status !== undefined && { status }),
        ...(accountUpdate ?? {}),
        ...(currentBalance !== undefined && { currentBalance: toCents(currentBalance) }),
        ...(principal !== undefined && { principal: principal === null ? null : toCents(principal) }),
        ...(apr !== undefined && { apr: apr === null ? null : Number(apr) }),
        ...(creditLimit !== undefined && { creditLimit: creditLimit === null ? null : toCents(creditLimit) }),
        ...(statementDay !== undefined && { statementDay: statementDay === null ? null : clampDay(statementDay) }),
        ...(paymentDueDay !== undefined && { paymentDueDay: paymentDueDay === null ? null : clampDay(paymentDueDay) }),
        ...(minimumPayment !== undefined && { minimumPayment: minimumPayment === null ? null : toCents(minimumPayment) }),
        ...(installmentAmount !== undefined && { installmentAmount: installmentAmount === null ? null : toCents(installmentAmount) }),
        ...(installmentsTotal !== undefined && { installmentsTotal: installmentsTotal === null ? null : parseInt(installmentsTotal, 10) || null }),
        ...(installmentsPaid !== undefined && { installmentsPaid: parseInt(installmentsPaid, 10) || 0 }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(visibility !== undefined && { visibility }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder, 10) }),
      },
    });

    // Keep any linked "debt" Allocation's line item in sync with the real
    // commitment — it's a derived value, never independently editable.
    if (minimumPayment !== undefined || installmentAmount !== undefined) {
      const monthlyCommitment = debt.minimumPayment ?? debt.installmentAmount ?? 0;
      await prisma.allocation.updateMany({
        where: { debtId: debt.id },
        data: { allocatedAmount: monthlyCommitment },
      });
    }

    return res.json(serializeMoney({ debt }));
  } catch (err) {
    console.error("[debts/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/debts/:id  — expenses keep their history (debtId set null)
debtsRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.debt.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Debt not found" });

    await prisma.debt.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[debts/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
