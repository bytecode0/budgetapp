import { Router, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { createDefaultAccount } from "../lib/defaults.js";
import { toCents, serializeMoney } from "../lib/money.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { currentPeriodKey, periodBounds } from "../lib/period.js";
import { loadDebtLedgers, debtState, owedNow, monthlyCommitment } from "../lib/debtBalance.js";
import { CARD_PAYMENT_MODES, createCardDebt, updateCardDebt, type CardSettings } from "../lib/cardDebt.js";

export const accountsRouter = Router();

const ACCOUNT_TYPES = new Set(["checking", "savings", "cash", "investment", "card"]);
const VISIBILITIES = new Set(["private", "household"]);

function clampDay(n: unknown): number | null {
  const v = parseInt(String(n), 10);
  if (!Number.isFinite(v)) return null;
  return Math.min(28, Math.max(1, v));
}

// Card settings sent with a card account (server/lib/cardDebt.ts). For a card,
// `currentBalance` in the body means what's OWED now, not money in the account.
function cardSettingsFrom(body: any): CardSettings | { error: string } {
  const { cardPaymentMode, currentBalance, cardMinimumPayment, cardPaymentDueDay } = body;
  if (cardPaymentMode !== undefined && !CARD_PAYMENT_MODES.has(cardPaymentMode)) return { error: "Invalid card payment mode" };
  return {
    ...(cardPaymentMode !== undefined && { paymentMode: cardPaymentMode }),
    ...(currentBalance !== undefined && { owed: Math.abs(toCents(currentBalance)) }),
    ...(cardMinimumPayment !== undefined && { minimumPayment: cardMinimumPayment === null || cardMinimumPayment === "" ? null : toCents(cardMinimumPayment) }),
    ...(cardPaymentDueDay !== undefined && { paymentDueDay: cardPaymentDueDay === null || cardPaymentDueDay === "" ? null : clampDay(cardPaymentDueDay) }),
  };
}

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

    // A card account carries its debt: what's owed now, how it's paid, and
    // this period's budget line.
    const cardDebts = await prisma.debt.findMany({
      where: { userId: req.userId!, kind: "credit_card", accountId: { in: accounts.filter(a => a.type === "card").map(a => a.id) } },
      select: { id: true, accountId: true, paymentMode: true, minimumPayment: true, paymentDueDay: true },
    });
    const ledgers = new Map((await loadDebtLedgers(req.userId!, cardDebts.map(d => d.id))).map(l => [l.debt.id, l]));
    const cycleStartDay = await getCycleStartDay(req.userId!);
    const period = periodBounds(currentPeriodKey(cycleStartDay), cycleStartDay);
    const cardByAccount = new Map(cardDebts.map(d => {
      const ledger = ledgers.get(d.id);
      return [d.accountId, {
        debtId: d.id,
        paymentMode: d.paymentMode,
        minimumPayment: d.minimumPayment,
        paymentDueDay: d.paymentDueDay,
        owed: ledger ? owedNow(ledger) : 0,
        monthlyCommitment: ledger ? monthlyCommitment(ledger, period) : 0,
      }];
    }));
    const withCards = accounts.map(a => ({ ...a, card: cardByAccount.get(a.id) ?? null }));

    return res.json(serializeMoney({ accounts: withCards, netWorth }));
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
    const card = type === "card" ? cardSettingsFrom(req.body) : null;
    if (card && "error" in card) return res.status(400).json({ error: card.error });

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
        // A card holds no money: what's owed lives on its debt.
        currentBalance: card ? 0 : toCents(currentBalance),
        sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
      },
    });

    if (card) {
      await createCardDebt({ userId: req.userId!, authUserId: req.authUserId!, householdId: req.householdId }, account, card);
    }

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

    const finalType = type ?? existing.type;
    const card = finalType === "card" ? cardSettingsFrom(req.body) : null;
    if (card && "error" in card) return res.status(400).json({ error: card.error });
    const linkedDebt = await prisma.debt.findFirst({ where: { userId: req.userId!, accountId: id, kind: "credit_card" }, select: { id: true } });

    // No longer a card: drop its debt — unless anything was recorded on it,
    // which would rewrite closed months (server/lib/debtBalance.ts).
    if (existing.type === "card" && finalType !== "card" && linkedDebt) {
      const [ledger] = await loadDebtLedgers(req.userId!, [linkedDebt.id]);
      if (ledger && ledger.payments.length + ledger.purchases.length + ledger.adjustments.length > 0) {
        return res.status(409).json({ error: "This card has recorded movements and can't change type", code: "card_has_movements" });
      }
      await prisma.allocation.deleteMany({ where: { userId: req.userId!, debtId: linkedDebt.id, type: "debt" } });
      await prisma.debt.delete({ where: { id: linkedDebt.id } });
    }

    const account = await prisma.account.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(currency !== undefined && { currency }),
        ...(currentBalance !== undefined && { currentBalance: card ? 0 : toCents(currentBalance) }),
        ...(isArchived !== undefined && { isArchived: Boolean(isArchived) }),
        ...(sortOrder !== undefined && { sortOrder: parseInt(sortOrder) }),
        ...(visibility !== undefined && { visibility }),
        ...(ownerUserId !== undefined && { ownerUserId }),
      },
    });

    if (card) {
      if (linkedDebt) await updateCardDebt(req.userId!, linkedDebt.id, { ...card, ...(name !== undefined && { name }) });
      else await createCardDebt({ userId: req.userId!, authUserId: req.authUserId!, householdId: req.householdId }, account, card);
    }

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

    // A card account backs a debt's purchases (server/lib/debtBalance.ts):
    // without it, the debt's payments would count in full in past months. A
    // card with nothing recorded yet takes its debt with it.
    const linkedDebt = await prisma.debt.findFirst({ where: { userId: req.userId!, accountId: id }, select: { id: true } });
    if (linkedDebt) {
      const [ledger] = await loadDebtLedgers(req.userId!, [linkedDebt.id]);
      if (ledger && ledger.payments.length + ledger.purchases.length + ledger.adjustments.length > 0) {
        return res.status(409).json({ error: "This account backs a debt — archive it instead", code: "account_backs_debt" });
      }
      await prisma.allocation.deleteMany({ where: { userId: req.userId!, debtId: linkedDebt.id, type: "debt" } });
      await prisma.debt.delete({ where: { id: linkedDebt.id } });
    }

    await prisma.account.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[accounts/DELETE]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
