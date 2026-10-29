// Live debt balances, derived — never stored (docs/plan-deudas-y-onboarding.md §1.2).
//
// Debt.currentBalance is an ANCHOR: what was owed at Debt.balanceAsOf. From
// there on, the ledger is:
//   - purchases:   expenses on the card's linked account (Debt.accountId) with
//                  no debtId — normal spending in its category that also grows
//                  the card debt. A refund (Expense.kind "refund") is a
//                  purchase undone: it enters negative;
//   - payments:    expenses with debtId = the debt — they shrink it;
//   - adjustments: dated corrections (DebtAdjustment) — interest, a purchase
//                  never recorded, a bank sync that disagrees.
// live balance = anchor + purchases + adjustments − payments. Editing or
// deleting a movement corrects the balance for free, the same "derive, don't
// store" approach as the budget period (server/lib/period.ts).
//
// Pre-existing debt = the anchor plus adjustments. Payments go to it first,
// then to purchases. Only the first part is budget spending: the rest pays for
// purchases already counted in their own category, so counting it again would
// count the groceries twice. That split is what countedAmounts() exposes to
// every place that sums expenses. Events are replayed in date order, so an
// adjustment only affects payments made after it — never a closed month.
import { prisma } from "./prisma.js";

export interface LedgerDebt {
  id: string;
  kind: string;
  status: string;
  paymentMode: string;
  accountId: string | null;
  currentBalance: number; // cents — the anchor
  installmentsPaid: number | null;
  installmentsTotal: number | null;
  installmentAmount: number | null;
  minimumPayment: number | null;
}

export interface LedgerMovement {
  id: string;
  amount: number; // cents (signed for adjustments)
  date: Date;
}

export interface DebtLedger {
  debt: LedgerDebt;
  purchases: LedgerMovement[]; // already limited to the anchor's ledger
  payments: LedgerMovement[];
  adjustments: LedgerMovement[];
}

export interface DebtState {
  balance: number;           // live balance (can go < 0 on overpayment)
  previousRemaining: number; // what's left of the pre-existing debt (anchor + adjustments)
  purchasesTotal: number;
  paymentsTotal: number;
  adjustmentsTotal: number;
  installmentsPaid: number;  // stored + payments since the anchor
}

export interface PaymentSplit {
  toPrevious: number;  // budget spending: pays down the pre-existing debt
  toPurchases: number; // transfer: pays for purchases already counted in their category
}

const sum = (ms: LedgerMovement[]) => ms.reduce((s, m) => s + m.amount, 0);

/** Replays adjustments and payments in date order (an adjustment before a
 *  payment on the same instant, so paying the interest the same day settles
 *  it). A debt with no linked card account has no purchases: every payment is
 *  budget spending in full, even an overpayment.
 *  `previousLeft` is a running total that may go negative: clamping it between
 *  events would make a −X correction followed by +X not cancel out. It's only
 *  floored where a payment is split and where it's reported. */
function replay(ledger: DebtLedger, before?: Date): { split: Map<string, PaymentSplit>; previousLeft: number } {
  const inRange = (m: LedgerMovement) => !before || m.date < before;
  const events = [
    ...ledger.adjustments.filter(inRange).map(m => ({ m, isPayment: false })),
    ...ledger.payments.filter(inRange).map(m => ({ m, isPayment: true })),
  ].sort((a, b) =>
    a.m.date.getTime() - b.m.date.getTime()
    || Number(a.isPayment) - Number(b.isPayment)
    || a.m.id.localeCompare(b.m.id));

  const split = new Map<string, PaymentSplit>();
  let previousLeft = ledger.debt.currentBalance;
  for (const { m, isPayment } of events) {
    if (!isPayment) {
      previousLeft += m.amount;
      continue;
    }
    if (!ledger.debt.accountId) {
      split.set(m.id, { toPrevious: m.amount, toPurchases: 0 });
      previousLeft -= m.amount;
      continue;
    }
    const toPrevious = Math.min(m.amount, Math.max(0, previousLeft));
    previousLeft -= toPrevious;
    split.set(m.id, { toPrevious, toPurchases: m.amount - toPrevious });
  }
  return { split, previousLeft };
}

/** Each payment split between pre-existing debt and purchases. */
export function splitPayments(ledger: DebtLedger): Map<string, PaymentSplit> {
  return replay(ledger).split;
}

/** The debt's state counting only movements dated before `before` (all of
 *  them when omitted). */
export function debtState(ledger: DebtLedger, before?: Date): DebtState {
  const inRange = (m: LedgerMovement) => !before || m.date < before;
  const purchasesTotal = sum(ledger.purchases.filter(inRange));
  const payments = ledger.payments.filter(inRange);
  const paymentsTotal = sum(payments);
  const adjustmentsTotal = sum(ledger.adjustments.filter(inRange));

  return {
    balance: ledger.debt.currentBalance + purchasesTotal + adjustmentsTotal - paymentsTotal,
    previousRemaining: Math.max(0, replay(ledger, before).previousLeft),
    purchasesTotal,
    paymentsTotal,
    adjustmentsTotal,
    installmentsPaid: (ledger.debt.installmentsPaid ?? 0) + payments.length,
  };
}

/** The starting balance (anchor, cents) to store for a debt being created —
 *  or edited before it has any balance information. An installment plan
 *  given only its cuota owes its remaining installments; that's written into
 *  the anchor once, so from then on the ledger alone says what's owed (edit
 *  form, totals, payoff and bank sync all agree). Anything else keeps the
 *  balance it was given. */
export function startingBalanceFor(d: {
  paymentMode: string;
  currentBalance: number; // cents, as entered
  installmentAmount: number | null;
  installmentsTotal: number | null;
  installmentsPaid: number | null;
}): number {
  if (d.currentBalance !== 0 || d.paymentMode !== "installments") return d.currentBalance;
  if (!d.installmentAmount || d.installmentAmount <= 0 || d.installmentsTotal == null) return d.currentBalance;
  return Math.max(0, d.installmentsTotal - (d.installmentsPaid ?? 0)) * d.installmentAmount;
}

/** What's still owed now — the one definition every total and payoff uses:
 *  the live balance of an active debt, never negative. A paid-off or archived
 *  debt owes nothing. */
export function owedNow(ledger: DebtLedger): number {
  if (ledger.debt.status !== "active") return 0;
  return Math.max(0, debtState(ledger).balance);
}

/** Whether a debt is paid off, judged automatically (after payments, bank
 *  sync, imports, edits):
 *  - by balance reaching 0 — only if the debt HAS balance information: a
 *    starting balance > 0, or any adjustment or purchase ever recorded. A debt
 *    entered without a balance (e.g. only its minimum, or a cuota with no
 *    count) goes negative with its first payment; that isn't "paid off";
 *  - by installment count, when the total is known.
 *  Otherwise never. A card isn't judged: it hits 0 every month in "full" mode
 *  and keeps being used. Setting the balance to 0 by hand is the user's
 *  decision and is handled by the route (paidOffByHand), not guessed here. */
export function isPaidOff(ledger: DebtLedger): boolean {
  const d = ledger.debt;
  if (d.kind === "credit_card") return false;
  const { balance, installmentsPaid } = debtState(ledger);
  const hasBalanceInfo = d.currentBalance > 0 || ledger.adjustments.length > 0 || ledger.purchases.length > 0;
  return (hasBalanceInfo && balance <= 0)
    || (d.installmentsTotal != null && installmentsPaid >= d.installmentsTotal);
}

/** "I owe 0 now", typed by the user on a debt that isn't a card: it's paid
 *  off. Decided from the request itself, because setLiveValues may move the
 *  anchor to 0 and the ledger can no longer tell it apart from "no balance". */
export function paidOffByHand(kind: string, liveBalanceCents: number): boolean {
  return kind !== "credit_card" && liveBalanceCents <= 0;
}

/** Total owed across the active debts — what "Deuda total" shows everywhere. */
export function sumOwed(ledgers: DebtLedger[]): number {
  return ledgers.filter(l => l.debt.status === "active").reduce((s, l) => s + owedNow(l), 0);
}

/** What the debt's budget line should hold for the period [start, end).
 *  Measured at the period's START, so paying during the period — including
 *  the final payment that marks it paid off — doesn't shrink the line it's
 *  being paid against. */
export function monthlyCommitment(ledger: DebtLedger, period: { start: Date; end: Date }): number {
  const d = ledger.debt;
  if (d.status === "archived") return 0;
  const atStart = debtState(ledger, period.start);

  switch (d.paymentMode) {
    case "full": {
      // Only the pre-existing debt: new purchases are already budgeted in
      // their own categories. A correction made during the period (interest)
      // is owed this period too. Unfloored running total, as in replay().
      const adjustedDuring = sum(ledger.adjustments.filter(a => a.date >= period.start && a.date < period.end));
      return Math.max(0, replay(ledger, period.start).previousLeft + adjustedDuring);
    }
    case "installments":
      if (d.installmentsTotal != null) {
        return atStart.installmentsPaid < d.installmentsTotal ? d.installmentAmount ?? 0 : 0;
      }
      return d.status === "active" || atStart.balance > 0 ? d.installmentAmount ?? 0 : 0;
    default:
      return d.status === "active" || atStart.balance > 0 ? d.minimumPayment ?? d.installmentAmount ?? 0 : 0;
  }
}

// ── Database side ──────────────────────────────────────────────────────────

const LEDGER_DEBT_SELECT = {
  id: true, kind: true, status: true, paymentMode: true, accountId: true,
  currentBalance: true, balanceAsOf: true,
  installmentsPaid: true, installmentsTotal: true, installmentAmount: true, minimumPayment: true,
} as const;

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Whether an expense belongs to the ledger that starts at `anchorAt`. By its
 *  DATE, so importing an old statement doesn't re-add movements the anchor
 *  already reflects. Expenses entered as a bare day (midnight) on the anchor's
 *  own day can't be ordered against it by date alone: those count if they were
 *  recorded after the anchor was set.
 *  Known limit: "own day" is the UTC day. Fine for Spain (UTC+1/+2); a user
 *  west of UTC creating a debt late in their evening would see that evening's
 *  bare-day entries left out. */
export function inLedger(e: { date: Date; createdAt: Date }, anchorAt: Date): boolean {
  if (utcDay(e.date) === utcDay(anchorAt)) return e.createdAt > anchorAt;
  return e.date > anchorAt;
}

/** An Expense as the ledgers read it. A refund (kind "refund") keeps its
 *  positive amount in the database but enters the ledger NEGATIVE: on a card
 *  account it's a purchase undone, lowering the debt. A refund is never a
 *  payment, even if it carries a debtId. */
export interface LedgerExpense {
  id: string;
  amount: number; // cents, positive as stored
  date: Date;
  createdAt: Date;
  debtId: string | null;
  accountId: string | null;
  kind: string; // expense | refund
}

export interface LedgerAdjustment { id: string; amount: number; date: Date; debtId: string }

/** Builds each debt's ledger from its rows (pure; loadDebtLedgers feeds it). */
export function buildLedgers(
  debts: (LedgerDebt & { balanceAsOf: Date })[],
  expenses: LedgerExpense[],
  adjustments: LedgerAdjustment[],
): DebtLedger[] {
  const signed = (e: LedgerExpense): LedgerMovement =>
    ({ id: e.id, amount: e.kind === "refund" ? -e.amount : e.amount, date: e.date });
  return debts.map(({ balanceAsOf, ...debt }) => ({
    debt,
    payments: expenses
      .filter(e => e.debtId === debt.id && e.kind !== "refund" && inLedger(e, balanceAsOf))
      .map(signed),
    purchases: debt.accountId
      ? expenses.filter(e => !e.debtId && e.accountId === debt.accountId && inLedger(e, balanceAsOf)).map(signed)
      : [],
    adjustments: adjustments.filter(a => a.debtId === debt.id).map(a => ({ id: a.id, amount: a.amount, date: a.date })),
  }));
}

/** Ledgers for the pool's debts (optionally only `debtIds`). */
export async function loadDebtLedgers(userId: string, debtIds?: string[]): Promise<DebtLedger[]> {
  const debts = await prisma.debt.findMany({
    where: { userId, ...(debtIds && { id: { in: debtIds } }) },
    select: LEDGER_DEBT_SELECT,
  });
  if (debts.length === 0) return [];

  const ids = debts.map(d => d.id);
  const accountIds = debts.map(d => d.accountId).filter((id): id is string => !!id);
  const movementSelect = { id: true, amount: true, date: true, createdAt: true, debtId: true, accountId: true, kind: true } as const;
  const [payments, purchases, adjustments] = await Promise.all([
    prisma.expense.findMany({ where: { userId, debtId: { in: ids } }, select: movementSelect }),
    accountIds.length
      ? prisma.expense.findMany({ where: { userId, debtId: null, accountId: { in: accountIds } }, select: movementSelect })
      : Promise.resolve([]),
    prisma.debtAdjustment.findMany({ where: { userId, debtId: { in: ids } }, select: { id: true, amount: true, date: true, debtId: true } }),
  ]);
  return buildLedgers(debts, [...payments, ...purchases], adjustments);
}

/** What each expense counts as budget spending, for the expenses where that
 *  differs from its amount: a debt payment that partly paid card purchases
 *  counts only its pre-existing-debt part; a refund counts negative (it
 *  lowers its category's spending). Pure; countedAmounts() feeds it. */
export function countedFrom(ledgers: DebtLedger[], refunds: { id: string; amount: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const ledger of ledgers) {
    for (const [id, s] of splitPayments(ledger)) {
      if (s.toPurchases > 0) out.set(id, s.toPrevious);
    }
  }
  for (const r of refunds) out.set(r.id, -r.amount);
  return out;
}

/** Budget-counted amount for every expense whose amount differs from what
 *  counts (see countedFrom). Every place that sums expenses must use
 *  `counted.get(e.id) ?? e.amount` instead of `e.amount`. */
export async function countedAmounts(userId: string): Promise<Map<string, number>> {
  const [ledgers, refunds] = await Promise.all([
    loadDebtLedgers(userId),
    prisma.expense.findMany({ where: { userId, kind: "refund" }, select: { id: true, amount: true } }),
  ]);
  return countedFrom(ledgers, refunds);
}

/** Budget-line amount per debt for the period [start, end). */
export async function debtCommitments(userId: string, period: { start: Date; end: Date }): Promise<Map<string, number>> {
  const ledgers = await loadDebtLedgers(userId);
  return new Map(ledgers.map(l => [l.debt.id, monthlyCommitment(l, period)]));
}

/** Writes each debt's commitment into its linked "debt" budget lines. The
 *  value is derived; it's stored only as a fallback for readers that don't
 *  recompute it — the readers that matter (allocations, monthly budgets,
 *  review, analytics) call debtCommitments() for the period they show. */
export async function syncDebtAllocations(userId: string, period: { start: Date; end: Date }, debtIds?: string[]): Promise<void> {
  for (const ledger of await loadDebtLedgers(userId, debtIds)) {
    await prisma.allocation.updateMany({
      where: { userId, debtId: ledger.debt.id },
      data: { allocatedAmount: monthlyCommitment(ledger, period) },
    });
  }
}

// Every active debt has its line in the budget, holding this period's
// commitment — the user never creates it by hand. Skips debts that already
// have one (e.g. seeded by the onboarding's budget step).
export async function ensureDebtLine(userId: string, debt: { id: string; name: string; status: string }, period: { start: Date; end: Date }): Promise<void> {
  if (debt.status !== "active") return;
  const existing = await prisma.allocation.findFirst({ where: { userId, debtId: debt.id }, select: { id: true } });
  if (existing) return;
  const [ledger] = await loadDebtLedgers(userId, [debt.id]);
  const lastOrder = await prisma.allocation.findFirst({ where: { userId }, orderBy: { sortOrder: "desc" } });
  await prisma.allocation.create({
    data: {
      userId,
      name: debt.name,
      icon: "🔒",
      type: "debt",
      debtId: debt.id,
      allocatedAmount: ledger ? monthlyCommitment(ledger, period) : 0,
      sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
      isDefault: false,
    },
  });
}

/** Makes the LIVE values equal what the user (or a bank sync) says they are
 *  now. With no movements yet the anchor itself is corrected (a typo at
 *  creation). Otherwise the difference becomes a dated adjustment: pre-existing
 *  debt from today on, without re-splitting earlier payments. installmentsPaid
 *  is a plain count and just shifts. */
export async function setLiveValues(
  userId: string,
  debtId: string,
  live: { balance?: number; installmentsPaid?: number },
): Promise<void> {
  const [ledger] = await loadDebtLedgers(userId, [debtId]);
  if (!ledger) return;
  const state = debtState(ledger);
  const hasMovements = ledger.payments.length + ledger.purchases.length + ledger.adjustments.length > 0;

  const data: { currentBalance?: number; balanceAsOf?: Date; installmentsPaid?: number } = {};
  if (live.balance !== undefined && live.balance !== state.balance) {
    if (hasMovements) {
      await prisma.debtAdjustment.create({ data: { userId, debtId, amount: live.balance - state.balance } });
    } else {
      // "I owe X now" — true as of now, so a statement imported later doesn't
      // re-add purchases this figure already includes.
      data.currentBalance = live.balance;
      data.balanceAsOf = new Date();
    }
  }
  if (live.installmentsPaid !== undefined && live.installmentsPaid !== state.installmentsPaid) {
    data.installmentsPaid = (ledger.debt.installmentsPaid ?? 0) + (live.installmentsPaid - state.installmentsPaid);
  }
  if (Object.keys(data).length > 0) await prisma.debt.update({ where: { id: debtId }, data });
}

/** A debt that reaches zero is paid off (and reopens if a payment is
 *  removed) — see isPaidOff. Called after payments and after the user sets
 *  the live balance by hand. */
export async function syncDebtStatus(userId: string, debtIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(debtIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  for (const ledger of await loadDebtLedgers(userId, ids)) {
    const { kind, status, id } = ledger.debt;
    if (kind === "credit_card" || status === "archived") continue;
    const paidOff = isPaidOff(ledger);
    if (status === "active" && paidOff) {
      await prisma.debt.update({ where: { id }, data: { status: "paid_off" } });
    } else if (status === "paid_off" && !paidOff) {
      await prisma.debt.update({ where: { id }, data: { status: "active" } });
    }
  }
}
