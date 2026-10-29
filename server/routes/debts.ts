import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { buildDebtTimeline } from "../lib/debtTimeline.js";
import { householdBaselineIncome } from "../lib/householdIncome.js";
import { simulatePayoff, type PayoffMethod } from "../lib/debtPayoff.js";
import { clampCycleStartDay, currentPeriodKey, periodBounds } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import {
  loadDebtLedgers, debtState, owedNow, monthlyCommitment, setLiveValues, syncDebtAllocations, syncDebtStatus, ensureDebtLine,
  startingBalanceFor, paidOffByHand, type DebtLedger,
} from "../lib/debtBalance.js";

export const debtsRouter = Router();

const DEBT_KINDS = new Set(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "student_loan", "mortgage", "other"]);
const DEBT_STATUSES = new Set(["active", "paid_off", "archived"]);
const VISIBILITIES = new Set(["private", "household"]);
const PAYMENT_MODES = new Set(["full", "installments", "minimum"]);

// Método Ruta R3: the debt frontier is by TYPE of debt, never by interest rate.
// Consumer/depreciating-asset debt (R3.1) is always inadmissible and always the
// snowball's attack target — an existing student loan isn't asset-backed, so it
// sits here too. "mortgage" (R3.2, appreciating/producing asset) and "other"
// (unclassified) sit outside the attack list — see scope=consumer below.
const CONSUMER_DEBT_KINDS = new Set(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "student_loan"]);

async function currentPeriod(userId: string): Promise<{ start: Date; end: Date }> {
  const day = await getCycleStartDay(userId);
  return periodBounds(currentPeriodKey(day), day);
}

// The API speaks LIVE values: `currentBalance` is the live ledger balance
// (what the edit form sends back as "I owe X now") and `installmentsPaid`
// counts payments recorded since the anchor. The stored anchor is exposed as
// `anchorBalance`. `owed` is what the app SHOWS as owed: owedNow(), which also
// covers a plan entered with only its cuota (see server/lib/debtBalance.ts).
function withLiveState<T extends { id: string; currentBalance: number }>(debt: T, ledger: DebtLedger | undefined, period: { start: Date; end: Date }) {
  if (!ledger) return { ...debt, owed: Math.max(0, debt.currentBalance), anchorBalance: debt.currentBalance, previousBalance: debt.currentBalance, purchasesTotal: 0, paymentsTotal: 0, monthlyCommitment: 0 };
  const state = debtState(ledger);
  return {
    ...debt,
    currentBalance: state.balance,
    owed: owedNow(ledger),
    anchorBalance: debt.currentBalance,
    previousBalance: state.previousRemaining,
    purchasesTotal: state.purchasesTotal,
    paymentsTotal: state.paymentsTotal,
    installmentsPaid: state.installmentsPaid,
    monthlyCommitment: monthlyCommitment(ledger, period),
  };
}

async function ledgersById(userId: string): Promise<Map<string, DebtLedger>> {
  return new Map((await loadDebtLedgers(userId)).map(l => [l.debt.id, l]));
}

// A credit card's purchases are expenses on its own account — that's how
// they grow the debt (server/lib/debtBalance.ts). Creates that account so the
// card shows up in the expense account picker.
async function createCardAccount(req: AuthRequest, name: string, visibility?: string): Promise<string> {
  const lastAccount = await prisma.account.findFirst({ where: { userId: req.userId! }, orderBy: { sortOrder: "desc" } });
  const account = await prisma.account.create({
    data: {
      userId: req.userId!,
      ownerUserId: req.authUserId!,
      householdId: req.householdId ?? null,
      name,
      type: "card",
      visibility: visibility ?? "household",
      sortOrder: (lastAccount?.sortOrder ?? -1) + 1,
    },
  });
  return account.id;
}

function defaultPaymentMode(kind: string | undefined): string {
  return !kind || kind === "credit_card" || kind === "other" ? "minimum" : "installments";
}

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

    const [ledgers, period] = await Promise.all([ledgersById(req.userId!), currentPeriod(req.userId!)]);
    const live = debts.map(d => withLiveState(d, ledgers.get(d.id), period));

    const active = live.filter(d => d.status === "active");
    const totalOwed = active.reduce((s, d) => s + d.owed, 0);
    const totalMinimums = active.reduce((s, d) => s + d.monthlyCommitment, 0);

    return res.json(serializeMoney({ debts: live, totalOwed, totalMinimums }));
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

    const [debts, settings, monthlyIncome] = await Promise.all([
      prisma.debt.findMany({
        where: { userId: req.userId!, OR: [{ ownerUserId: req.authUserId! }, { visibility: "household" }] },
        select: { id: true, name: true, kind: true, status: true, paymentMode: true, minimumPayment: true, installmentAmount: true, installmentsTotal: true, installmentsPaid: true },
      }),
      prisma.userSettings.findUnique({ where: { userId: req.userId! }, select: { cycleStartDay: true } }),
      householdBaselineIncome(req.userId!),
    ]);

    const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
    const period = periodBounds(currentPeriodKey(cycleStartDay), cycleStartDay);
    const ledgers = await ledgersById(req.userId!);
    // Measured at the period's start, like the budget line, so paying during
    // this period doesn't make the commitment vanish from it. A card paid in
    // full commits exactly what its budget line holds this period.
    const live = debts.map(d => {
      const ledger = ledgers.get(d.id);
      if (!ledger) return d;
      const atStart = debtState(ledger, period.start);
      return { ...d, installmentsPaid: atStart.installmentsPaid, previousRemaining: monthlyCommitment(ledger, period) };
    });
    const timeline = buildDebtTimeline(live, monthlyIncome, cycleStartDay, periodsCount);

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
      select: { id: true, name: true, currentBalance: true, apr: true, minimumPayment: true, installmentAmount: true, paymentMode: true },
    });

    if (debts.length === 0) return res.json({ snowball: null, avalanche: null });

    // Simulate on live balances. A card paid in full clears its whole balance
    // each month, so that's its "minimum" for the cascade.
    const ledgers = await ledgersById(req.userId!);
    const live = debts.map(({ paymentMode, ...d }) => {
      const ledger = ledgers.get(d.id);
      const balance = ledger ? owedNow(ledger) : d.currentBalance;
      return { ...d, currentBalance: balance, ...(paymentMode === "full" && { minimumPayment: balance }) };
    });

    const nameById = Object.fromEntries(debts.map(d => [d.id, d.name]));
    const withNames = (r: ReturnType<typeof simulatePayoff>) => ({
      ...r,
      payoffOrder: r.payoffOrder.map(p => ({ ...p, name: nameById[p.id] ?? null })),
    });

    const methods: PayoffMethod[] = ["snowball", "avalanche"];
    const [snowball, avalanche] = methods.map(m => withNames(simulatePayoff(live, m, extraPaymentCents)));

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
      visibility, paymentMode,
    } = req.body;

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (kind !== undefined && !DEBT_KINDS.has(kind)) {
      return res.status(400).json({ error: "Invalid debt kind" });
    }
    if (paymentMode !== undefined && !PAYMENT_MODES.has(paymentMode)) {
      return res.status(400).json({ error: "Invalid payment mode" });
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

    if (kind === "credit_card" && !resolvedAccountId) {
      resolvedAccountId = await createCardAccount(req, name, visibility);
    }

    const lastOrder = await prisma.debt.findFirst({
      where: { userId: req.userId! },
      orderBy: { sortOrder: "desc" },
    });

    const finalPaymentMode = paymentMode ?? defaultPaymentMode(kind);
    const installmentAmountCents = installmentAmount !== undefined ? toCents(installmentAmount) : null;
    const installmentsTotalN = installmentsTotal !== undefined ? parseInt(installmentsTotal, 10) || null : null;
    const installmentsPaidN = installmentsPaid !== undefined ? parseInt(installmentsPaid, 10) || 0 : 0;
    // Given only its cuota, a plan starts owing its remaining cuotas — stored
    // as the anchor so the ledger alone says what's owed from now on.
    const startingBalance = startingBalanceFor({
      paymentMode: finalPaymentMode,
      currentBalance: toCents(currentBalance),
      installmentAmount: installmentAmountCents,
      installmentsTotal: installmentsTotalN,
      installmentsPaid: installmentsPaidN,
    });

    const debt = await prisma.debt.create({
      data: {
        userId: req.userId!,
        ownerUserId: req.authUserId!,
        householdId: req.householdId ?? null,
        visibility: visibility ?? "household",
        name,
        kind: kind ?? "other",
        paymentMode: finalPaymentMode,
        accountId: resolvedAccountId,
        currentBalance: startingBalance,
        principal: principal !== undefined ? toCents(principal) : null,
        apr: apr !== undefined && apr !== null ? Number(apr) : null,
        creditLimit: creditLimit !== undefined ? toCents(creditLimit) : null,
        statementDay: statementDay !== undefined ? clampDay(statementDay) : null,
        paymentDueDay: paymentDueDay !== undefined ? clampDay(paymentDueDay) : null,
        minimumPayment: minimumPayment !== undefined ? toCents(minimumPayment) : null,
        installmentAmount: installmentAmountCents,
        installmentsTotal: installmentsTotalN,
        installmentsPaid: installmentsPaidN,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
      },
    });

    const period = await currentPeriod(req.userId!);
    await ensureDebtLine(req.userId!, debt, period);

    const [ledger] = await loadDebtLedgers(req.userId!, [debt.id]);
    return res.json(serializeMoney({ debt: withLiveState(debt, ledger, period) }));
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
      visibility, sortOrder, paymentMode,
    } = req.body;

    if (kind !== undefined && !DEBT_KINDS.has(kind)) return res.status(400).json({ error: "Invalid debt kind" });
    if (paymentMode !== undefined && !PAYMENT_MODES.has(paymentMode)) return res.status(400).json({ error: "Invalid payment mode" });
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
    // The linked account decides which expenses are purchases and how past
    // payments split (server/lib/debtBalance.ts): once anything is recorded,
    // changing it would rewrite closed months.
    if (accountUpdate && accountUpdate.accountId !== existing.accountId) {
      const [ledger] = await loadDebtLedgers(req.userId!, [id]);
      if (ledger && ledger.payments.length + ledger.purchases.length + ledger.adjustments.length > 0) {
        return res.status(409).json({ error: "The account of a debt with recorded movements can't change", code: "debt_account_locked" });
      }
    }

    // A card created before cards got their own account (or edited into a
    // card) gets one now, as on creation.
    const finalKind = kind ?? existing.kind;
    const finalAccountId = accountUpdate ? accountUpdate.accountId : existing.accountId;
    if (finalKind === "credit_card" && !finalAccountId) {
      accountUpdate = { accountId: await createCardAccount(req, name ?? existing.name, existing.visibility) };
    }

    // currentBalance / installmentsPaid arrive as LIVE values ("I owe X now"):
    // a difference becomes a dated adjustment / shifted count. The client only
    // sends them when the user changed them, so a stale form can't undo a
    // movement recorded meanwhile.
    await setLiveValues(req.userId!, id, {
      ...(currentBalance !== undefined && { balance: toCents(currentBalance) }),
      ...(installmentsPaid !== undefined && { installmentsPaid: parseInt(installmentsPaid, 10) || 0 }),
    });
    // Set to 0 by hand: the user says it's paid off (an explicit status in
    // the same request wins).
    const zeroedByHand = status === undefined && currentBalance !== undefined
      && paidOffByHand(finalKind, toCents(currentBalance));

    const debt = await prisma.debt.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(paymentMode !== undefined && { paymentMode }),
        ...(kind !== undefined && { kind }),
        ...(status !== undefined && { status }),
        ...(zeroedByHand && { status: "paid_off" }),
        ...(accountUpdate ?? {}),
        ...(principal !== undefined && { principal: principal === null ? null : toCents(principal) }),
        ...(apr !== undefined && { apr: apr === null ? null : Number(apr) }),
        ...(creditLimit !== undefined && { creditLimit: creditLimit === null ? null : toCents(creditLimit) }),
        ...(statementDay !== undefined && { statementDay: statementDay === null ? null : clampDay(statementDay) }),
        ...(paymentDueDay !== undefined && { paymentDueDay: paymentDueDay === null ? null : clampDay(paymentDueDay) }),
        ...(minimumPayment !== undefined && { minimumPayment: minimumPayment === null ? null : toCents(minimumPayment) }),
        ...(installmentAmount !== undefined && { installmentAmount: installmentAmount === null ? null : toCents(installmentAmount) }),
        ...(installmentsTotal !== undefined && { installmentsTotal: installmentsTotal === null ? null : parseInt(installmentsTotal, 10) || null }),
        ...(startDate !== undefined && { startDate: startDate ? new Date(startDate) : null }),
        ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
        ...(visibility !== undefined && { visibility }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder, 10) }),
      },
    });

    // A plan edited while it still has no balance information (anchor 0, no
    // movements, balance not being set now) gets its starting balance, as on
    // creation — e.g. its cuotas were only filled in now.
    if (currentBalance === undefined && debt.status === "active" && debt.currentBalance === 0) {
      const [ledger] = await loadDebtLedgers(req.userId!, [id]);
      const hasMovements = ledger && ledger.payments.length + ledger.purchases.length + ledger.adjustments.length > 0;
      const starting = startingBalanceFor(debt);
      if (!hasMovements && starting > 0) {
        await prisma.debt.update({ where: { id }, data: { currentBalance: starting, balanceAsOf: new Date() } });
      }
    }

    // Any other balance or installment count set by hand settles the status
    // like a payment does (e.g. reopens a paid-off debt given a balance again).
    if (status === undefined && !zeroedByHand && (currentBalance !== undefined || installmentsPaid !== undefined)) {
      await syncDebtStatus(req.userId!, [id]);
    }

    // Keep any linked "debt" Allocation's line item in sync with the real
    // commitment — it's a derived value, never independently editable.
    const period = await currentPeriod(req.userId!);
    await ensureDebtLine(req.userId!, debt, period);
    await syncDebtAllocations(req.userId!, period, [debt.id]);

    const fresh = await prisma.debt.findUniqueOrThrow({ where: { id: debt.id } });
    const [ledger] = await loadDebtLedgers(req.userId!, [debt.id]);
    return res.json(serializeMoney({ debt: withLiveState(fresh, ledger, period) }));
  } catch (err) {
    console.error("[debts/PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/debts/:id  — only debts with no recorded payments (see below)
debtsRouter.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.debt.findFirst({ where: { id, userId: req.userId! } });
    if (!existing) return res.status(404).json({ error: "Debt not found" });

    // Its payments' budget split (server/lib/debtBalance.ts) needs the debt:
    // deleting it would make past months count those payments in full.
    const payments = await prisma.expense.count({ where: { userId: req.userId!, debtId: id } });
    if (payments > 0) {
      return res.status(409).json({ error: "This debt has recorded payments and can't be deleted", code: "debt_has_payments" });
    }

    await prisma.allocation.deleteMany({ where: { userId: req.userId!, debtId: id, type: "debt" } });
    await prisma.debt.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[debts/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
