import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { mutationAccess, reorderableEntries, visibleToWhere } from "../lib/ownership.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { buildDebtTimeline, timelineInput } from "../lib/debtTimeline.js";
import { householdBaselineIncome } from "../lib/householdIncome.js";
import { debtAccountLinkError, cardDebtKindLocked, creditCardOnNonCardAccount, type DebtAccountLinkError } from "../lib/debtAccountLink.js";
import { clampCycleStartDay, currentPeriodKey, periodBounds, periodKeyOffset } from "../lib/period.js";
import { cardCycleSummary, isoDay } from "../lib/cardCycle.js";
import { now as clockNow } from "../lib/clock.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { visibleExpenseWhere } from "../lib/poolRefs.js";
import { debtProjection, monthKeyOf, parseSimulatorQuery, pastBalances, payoffPlan, type SimulatorInput } from "../lib/debtProjection.js";
import {
  loadDebtLedgers, debtState, owedNow, monthlyCommitment, setLiveValues, syncDebtAllocations, syncDebtStatus, ensureDebtLine,
  startingBalanceFor, paidOffByHand, type DebtLedger,
} from "../lib/debtBalance.js";

export const debtsRouter = Router();

const DEBT_KINDS = new Set(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "student_loan", "mortgage", "other"]);
const DEBT_STATUSES = new Set(["active", "paid_off", "archived"]);
const VISIBILITIES = new Set(["private", "household"]);
const PAYMENT_MODES = new Set(["full", "installments", "minimum"]);

async function currentPeriod(userId: string): Promise<{ start: Date; end: Date }> {
  const day = await getCycleStartDay(userId);
  return periodBounds(currentPeriodKey(day, clockNow()), day);
}

// The API speaks LIVE values: `currentBalance` is the live ledger balance
// (what the edit form sends back as "I owe X now") and `installmentsPaid`
// counts payments recorded since the anchor. The stored anchor is exposed as
// `anchorBalance`. `owed` is what the app SHOWS as owed: owedNow(), which also
// covers a plan entered with only its cuota (see server/lib/debtBalance.ts).
function withLiveState<T extends { id: string; currentBalance: number }>(debt: T, ledger: DebtLedger | undefined, period: { start: Date; end: Date }) {
  if (!ledger) return { ...debt, owed: Math.max(0, debt.currentBalance), anchorBalance: debt.currentBalance, previousBalance: debt.currentBalance, purchasesTotal: 0, paymentsTotal: 0, monthlyCommitment: 0, cycle: null };
  const state = debtState(ledger);
  // A card with a billing cycle: "lo que vence" (dueAmount, on dueOn) vs the
  // rest of `owed`, due on the following due date (server/lib/cardCycle.ts).
  const cycle = ledger.debt.status === "active" ? cardCycleSummary(ledger, clockNow()) : null;
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
    cycle: cycle && {
      dueOn: isoDay(cycle.dueOn),
      closesOn: isoDay(cycle.closesOn),
      closed: cycle.closed,
      dueAmount: cycle.dueAmount,
      minimumDue: cycle.minimumDue,
      afterCutAmount: cycle.afterCutAmount,
      afterCutDueOn: isoDay(cycle.afterCutDueOn),
    },
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

const LINK_ERROR_MESSAGES: Record<DebtAccountLinkError, string> = {
  card_already_has_debt: "This card already has its debt; record it on the card account",
  debt_account_owner_mismatch: "A debt can only be linked to an account of its own owner",
  credit_card_needs_card_account: "A credit card debt can only be linked to a card account",
};

/** The account `accountId` if it's in the pool, visible to the caller and a
 *  valid link for the debt (server/lib/debtAccountLink.ts). `null` when it
 *  isn't usable (ignored, as before), `{ error }` when the link is refused. */
async function linkableAccount(
  req: AuthRequest, accountId: string, debt: { id?: string; ownerUserId: string; kind: string },
): Promise<{ id: string } | { error: DebtAccountLinkError } | null> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: req.userId!, ...visibleToWhere(req.authUserId!) },
    select: { id: true, type: true, ownerUserId: true },
  });
  if (!account) return null;
  const onAccount = await prisma.debt.findMany({ where: { userId: req.userId!, accountId: account.id }, select: { id: true } });
  const code = debtAccountLinkError(debt, account, onAccount);
  return code ? { error: code } : { id: account.id };
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
        ...visibleToWhere(req.authUserId!),
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
// Only the debts the caller can see (another member's private debt is left
// out, as in GET /api/debts).
debtsRouter.get("/timeline", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const periodsCount = Math.min(24, Math.max(1, parseInt(String(req.query.periods ?? "6"), 10) || 6));

    const [debts, settings, monthlyIncome] = await Promise.all([
      prisma.debt.findMany({
        where: { userId: req.userId!, ...visibleToWhere(req.authUserId!) },
        select: { id: true, name: true, kind: true, status: true, paymentMode: true, minimumPayment: true, installmentAmount: true, installmentsTotal: true, installmentsPaid: true },
      }),
      prisma.userSettings.findUnique({ where: { userId: req.userId! }, select: { cycleStartDay: true } }),
      householdBaselineIncome(req.userId!),
    ]);

    const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
    const now = clockNow();
    const currentKey = currentPeriodKey(cycleStartDay, now);
    const periods = Array.from({ length: periodsCount }, (_, i) => periodBounds(periodKeyOffset(currentKey, i), cycleStartDay));
    const ledgers = await ledgersById(req.userId!);
    // The current period commits exactly what each budget line holds; a card
    // paid in full with a billing cycle places its later-due pre-existing
    // debt in later periods (timelineInput, server/lib/debtTimeline.ts).
    const live = debts.map(d => {
      const ledger = ledgers.get(d.id);
      return ledger ? timelineInput(d, ledger, periods) : d;
    });
    const timeline = buildDebtTimeline(live, monthlyIncome, cycleStartDay, periodsCount, now);

    return res.json(serializeMoney({ timeline }));
  } catch (err) {
    console.error("[debts/timeline]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PROJECTION_DEBT_SELECT = {
  id: true, name: true, kind: true, status: true, paymentMode: true, apr: true,
  minimumPayment: true, installmentAmount: true, installmentsTotal: true, ownerUserId: true, accountId: true,
} as const;

const HISTORY_CAP = 200;

const simulatorEcho = (input: SimulatorInput) => ({
  method: input.method,
  extraPayment: input.extraCents,
  oneOffAmount: input.oneOff?.amountCents ?? 0,
  oneOffMonth: input.oneOff?.monthKey ?? null,
});

// GET /api/debts/plan?method=snowball|avalanche&extra=&oneOff=&oneOffMonth=YYYY-MM
// The payoff plan screen (LPBETA-02): every active debt the caller can see
// (another member's private debt never enters), month by month until zero,
// the other method's summary and the "solo mínimos" reference. Only for
// looking: nothing is saved (server/lib/debtProjection.ts).
debtsRouter.get("/plan", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const now = clockNow();
    const input = parseSimulatorQuery(req.query, now);
    if ("error" in input) return res.status(400).json(input);

    const debts = await prisma.debt.findMany({
      where: { userId: req.userId!, status: "active", ...visibleToWhere(req.authUserId!) },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: PROJECTION_DEBT_SELECT,
    });
    const [ledgers, period] = await Promise.all([
      debts.length ? ledgersById(req.userId!) : new Map<string, DebtLedger>(),
      currentPeriod(req.userId!),
    ]);
    const withLedgers = debts.flatMap(debt => {
      const ledger = ledgers.get(debt.id);
      return ledger ? [{ debt, ledger }] : [];
    });

    const plan = payoffPlan(withLedgers, input, now, period);
    if ("code" in plan) return res.status(400).json(plan);
    return res.json(serializeMoney({ data: { ...plan, simulator: simulatorEcho(input) } }));
  } catch (err) {
    console.error("[debts/plan]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/debts/:id/detail?extra=&oneOff=&oneOffMonth=YYYY-MM
// One debt's detail screen: its real past balance (from its ledger), the
// projection with and without the simulator's extra / one-off, and its
// payment and purchase history. A debt hidden from the caller answers 404.
debtsRouter.get("/:id/detail", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const now = clockNow();
    const input = parseSimulatorQuery(req.query, now);
    if ("error" in input) return res.status(400).json(input);

    const debt = await prisma.debt.findFirst({
      where: { id: req.params.id, userId: req.userId!, ...visibleToWhere(req.authUserId!) },
      select: PROJECTION_DEBT_SELECT,
    });
    if (!debt) return res.status(404).json({ error: "Debt not found" });
    const [ledger] = await loadDebtLedgers(req.userId!, [debt.id]);
    if (!ledger) return res.status(404).json({ error: "Debt not found" });

    const projection = debtProjection(debt, ledger, input, now, await currentPeriod(req.userId!));
    if ("code" in projection) return res.status(400).json(projection);

    // Payments, purchases and adjustments: the HISTORY_CAP most recent
    // across all three, newest first (date, then when it was recorded).
    const state = debtState(ledger);
    const kindOf = new Map<string, "payment" | "purchase">([
      ...ledger.payments.map(m => [m.id, "payment"] as const),
      ...ledger.purchases.map(m => [m.id, "purchase"] as const),
    ]);
    const newestFirst = [{ date: "desc" as const }, { createdAt: "desc" as const }];
    const [expenses, adjustments] = await Promise.all([
      kindOf.size
        ? prisma.expense.findMany({
          where: { userId: req.userId!, id: { in: [...kindOf.keys()] }, ...visibleExpenseWhere(req.authUserId!) },
          select: { id: true, amount: true, date: true, createdAt: true, description: true, kind: true },
          orderBy: newestFirst,
          take: HISTORY_CAP,
        })
        : Promise.resolve([]),
      prisma.debtAdjustment.findMany({
        where: { userId: req.userId!, debtId: debt.id },
        select: { id: true, amount: true, date: true, createdAt: true },
        orderBy: newestFirst,
        take: HISTORY_CAP,
      }),
    ]);
    const history = [
      ...expenses.map(e => ({ ...e, type: e.kind === "refund" ? "refund" : kindOf.get(e.id)! })),
      ...adjustments.map(a => ({ ...a, type: "adjustment", description: null })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, HISTORY_CAP)
      .map(h => ({ id: h.id, type: h.type, amount: h.amount, date: isoDay(h.date), description: h.description }));

    return res.json(serializeMoney({
      data: {
        debt: { ...debt, owed: owedNow(ledger), paymentsTotal: state.paymentsTotal, purchasesTotal: state.purchasesTotal },
        startMonth: monthKeyOf(now),
        assumesNoNewPurchases: debt.kind === "credit_card",
        past: pastBalances(ledger, now),
        projection,
        history,
        simulator: simulatorEcho(input),
      },
    }));
  } catch (err) {
    console.error("[debts/detail]", err);
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

    // A linked account must be in the pool and visible to the caller (another
    // member's private account is as good as nonexistent).
    let resolvedAccountId: string | null = null;
    if (accountId) {
      const linked = await linkableAccount(req, accountId, { ownerUserId: req.authUserId!, kind: kind ?? "other" });
      if (linked && "error" in linked) return res.status(409).json({ error: LINK_ERROR_MESSAGES[linked.error], code: linked.error });
      if (linked) resolvedAccountId = linked.id;
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

    // Only rows the caller can see (the same rule as GET); others are ignored.
    const visible = await prisma.debt.findMany({
      where: { userId: req.userId!, ...visibleToWhere(req.authUserId!) },
      select: { id: true },
    });
    const entries = reorderableEntries(order, new Set(visible.map(r => r.id)));

    await prisma.$transaction(
      entries.map(({ id, sortOrder }) =>
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
    const access = mutationAccess(existing, req.authUserId);
    if (access === "hidden") return res.status(404).json({ error: "Debt not found" });
    if (access === "forbidden") return res.status(403).json({ error: "Only the owner can change this debt" });

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
        // Same rule as POST: in the pool, visible to the caller, a valid link.
        const linked = await linkableAccount(req, accountId, { ...existing, kind: kind ?? existing.kind });
        if (linked && "error" in linked) return res.status(409).json({ error: LINK_ERROR_MESSAGES[linked.error], code: linked.error });
        if (linked) accountUpdate = { accountId: linked.id };
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

    // The debt behind a card account is a credit_card for good: another kind
    // would slip out of the rules that keep it mirroring its card.
    const existingAccount = existing.accountId
      ? await prisma.account.findUnique({ where: { id: existing.accountId }, select: { type: true } })
      : null;
    if (cardDebtKindLocked(existing, existingAccount?.type ?? null, kind)) {
      return res.status(409).json({ error: "A card's debt stays a credit card; change the card account instead", code: "card_debt_kind_locked" });
    }
    // Nor does a debt turn into a card on an account that isn't one (a new
    // link was already checked above).
    if (!accountUpdate && kind !== undefined && kind !== existing.kind && existingAccount
      && creditCardOnNonCardAccount(kind, existingAccount.type)) {
      return res.status(409).json({ error: LINK_ERROR_MESSAGES.credit_card_needs_card_account, code: "credit_card_needs_card_account" });
    }

    // A card created before cards got their own account (or edited into a
    // card) gets one now, as on creation.
    const finalKind = kind ?? existing.kind;
    const finalAccountId = accountUpdate ? accountUpdate.accountId : existing.accountId;

    // A card's debt mirrors its card account's owner and visibility
    // (server/lib/cardDebt.ts, kept in step from PATCH /api/accounts/:id).
    // Changed here, the two would drift apart.
    if (visibility !== undefined && visibility !== existing.visibility && finalKind === "credit_card" && finalAccountId) {
      const account = await prisma.account.findUnique({ where: { id: finalAccountId }, select: { type: true } });
      if (account?.type === "card") {
        return res.status(409).json({ error: "A card's debt follows its card account's visibility; change it on the account", code: "card_debt_visibility_locked" });
      }
    }
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
    const access = mutationAccess(existing, req.authUserId);
    if (access === "hidden") return res.status(404).json({ error: "Debt not found" });
    if (access === "forbidden") return res.status(403).json({ error: "Only the owner can change this debt" });

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
