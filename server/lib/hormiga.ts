// Gastos hormiga (LPBETA-12): the money that "disappears" without being seen.
// No AI and nothing leaves the server: a heuristic over the movements already
// stored, in integer cents.
//
// A gasto hormiga is EITHER (decision of 18 Nov 2026):
//   (a) a SMALL, FREQUENT expense: under 10 € a time, 4 or more times in the
//       month at the same merchant — or, for the rest, in the same budget
//       category; or
//   (b) ANY SUBSCRIPTION, whatever its amount: a charge server/lib/recurring.ts
//       detects as recurring (weekly, monthly or yearly). Netflix counts even
//       though it is charged once a month.
//
// Not a subscription (excluded from b), decided only from what is already in
// the data:
//   - a charge that pays a debt (Expense.debtId: loan and card payments,
//     including paying a card from the bank account);
//   - a charge whose category (its most common budget line) is a debt line
//     (type "debt" or linked to a Debt), a savings plan ("plan") or
//     Generosity ("generosity"): those are commitments, not consumption;
//   - a category whose name clearly says housing, utilities or insurance:
//     one of the WHOLE words in NOT_SUBSCRIPTION_WORDS (accents and case
//     ignored), so "Alquiler o hipoteca", "Luz, agua y gas" or "Seguros" are
//     out, while "Gastos fijos" is not ("gas" must be a word of its own);
//   - a commitment the household marked "ignored" in the budget (not
//     recurring, by their own word).
// A subscription is never also counted as a small frequent expense.
//
// Totals: a weekly price × 52, monthly × 12, yearly × 1 per year; per month,
// the year / 12. A small expense's year is its month × 12 ("~690 € al año").
// "Si lo reduces a la mitad": half the yearly total. Rounded only on display.
import type { PrismaClient } from "@prisma/client";
import { detectRecurringFrom, type Cadence, type RecurringCandidate } from "./recurring.js";

export const SMALL_MAX_CENTS = 1000; // under 10 €
export const SMALL_MIN_COUNT = 4;    // 4 or more times in the month

/** Budget line types that are not spending you could trim. */
const NOT_SPENDING_LINE_TYPES = new Set(["debt", "plan", "generosity"]);

/** Whole words (no accents, lowercase) that mark a category as housing,
 *  utilities or insurance: recurring, but not a subscription. */
export const NOT_SUBSCRIPTION_WORDS: ReadonlySet<string> = new Set([
  // housing
  "alquiler", "alquileres", "hipoteca", "hipotecas", "vivienda", "comunidad", "ibi",
  "rent", "mortgage", "housing", "hoa",
  // utilities
  "luz", "agua", "gas", "electricidad", "suministro", "suministros",
  "utilities", "utility", "electricity", "water", "power",
  // insurance
  "seguro", "seguros", "insurance",
]);

export interface LineInfo {
  id: string;
  name: string;
  icon: string;
  type: string;
  debtId: string | null;
}

export interface ChargeInfo {
  merchant: string;
  amount: number;          // cents, positive
  date: Date;
  allocationId: string | null;
  debtId: string | null;
}

/** The words of a name: accents dropped, lowercase, split on anything else. */
export function nameWords(name: string): string[] {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

const notSpendingLine = (line: LineInfo | undefined) =>
  !!line && (NOT_SPENDING_LINE_TYPES.has(line.type) || line.debtId !== null);

/** Whether a budget line marks its recurring charges as "not a subscription". */
export function notSubscriptionLine(line: LineInfo | undefined): boolean {
  if (!line) return false;
  return notSpendingLine(line) || nameWords(line.name).some(w => NOT_SUBSCRIPTION_WORDS.has(w));
}

/** The merchants with a charge that pays a debt. */
export function debtPaymentMerchants(charges: ChargeInfo[]): Set<string> {
  return new Set(charges.filter(x => x.debtId !== null).map(x => x.merchant));
}

/** The rule above, for one detected merchant. `debtMerchants`: from
 *  debtPaymentMerchants over the same history. */
export function isSubscription(c: RecurringCandidate, debtMerchants: ReadonlySet<string>, lines: ReadonlyMap<string, LineInfo>): boolean {
  if (debtMerchants.has(c.merchant)) return false;
  return !(c.allocationId && notSubscriptionLine(lines.get(c.allocationId)));
}

const PER_YEAR: Record<Cadence, number> = { weekly: 52, monthly: 12, yearly: 1 };

export function yearlyCents(amount: number, cadence: Cadence): number {
  return amount * PER_YEAR[cadence];
}
export function monthlyCents(amount: number, cadence: Cadence): number {
  return Math.round(yearlyCents(amount, cadence) / 12);
}

export interface SubscriptionItem {
  merchant: string;
  cadence: Cadence;
  amount: number;            // cents, the price now (the latest one after a rise)
  monthlyAmount: number;     // cents
  yearlyAmount: number;      // cents
  previousAmount: number | null; // cents, the price before a rise
  isNew: boolean;
  lastDate: Date;
  nextExpectedDate: Date;
}

export function subscriptionItem(c: RecurringCandidate): SubscriptionItem {
  const amount = c.previousAmount !== null ? c.lastAmount : c.avgAmount;
  return {
    merchant: c.merchant,
    cadence: c.cadence,
    amount,
    monthlyAmount: monthlyCents(amount, c.cadence),
    yearlyAmount: yearlyCents(amount, c.cadence),
    previousAmount: c.previousAmount,
    isNew: c.isNew,
    lastDate: c.lastDate,
    nextExpectedDate: c.nextExpectedDate,
  };
}

export interface SmallItem {
  kind: "merchant" | "category";
  key: string;               // the merchant, or the budget line id
  label: string;             // the merchant, or the budget line's name
  icon: string | null;       // the budget line's icon (categories only)
  count: number;
  amount: number;            // cents, the average ticket
  total: number;             // cents, this month
  yearlyTotal: number;       // cents, total × 12
}

/** Rule (a) over one month's expenses (refunds already left out). Merchants
 *  first; what is left groups by category. `skipMerchants`: the
 *  subscriptions, never counted twice. */
export function smallFrequentFrom(
  monthCharges: ChargeInfo[], lines: ReadonlyMap<string, LineInfo>, skipMerchants: ReadonlySet<string> = new Set(),
): SmallItem[] {
  const eligible = monthCharges.filter(x =>
    x.amount > 0 && x.amount < SMALL_MAX_CENTS && x.debtId === null
    && !skipMerchants.has(x.merchant)
    && !(x.allocationId && notSpendingLine(lines.get(x.allocationId))));

  const item = (kind: SmallItem["kind"], key: string, label: string, icon: string | null, group: ChargeInfo[]): SmallItem => {
    const total = group.reduce((s, x) => s + x.amount, 0);
    return { kind, key, label, icon, count: group.length, amount: Math.round(total / group.length), total, yearlyTotal: total * 12 };
  };
  const groupBy = (rows: ChargeInfo[], keyOf: (x: ChargeInfo) => string | null) => {
    const out = new Map<string, ChargeInfo[]>();
    for (const x of rows) {
      const k = keyOf(x);
      if (k) out.set(k, [...(out.get(k) ?? []), x]);
    }
    return out;
  };

  const items: SmallItem[] = [];
  const used = new Set<ChargeInfo>();
  for (const [merchant, group] of groupBy(eligible, x => x.merchant || null)) {
    if (group.length < SMALL_MIN_COUNT) continue;
    items.push(item("merchant", merchant, merchant, null, group));
    for (const x of group) used.add(x);
  }
  const rest = eligible.filter(x => !used.has(x) && x.allocationId && lines.has(x.allocationId));
  for (const [lineId, group] of groupBy(rest, x => x.allocationId)) {
    if (group.length < SMALL_MIN_COUNT) continue;
    const line = lines.get(lineId)!;
    items.push(item("category", lineId, line.name, line.icon, group));
  }
  return items.sort((a, b) => b.total - a.total);
}

export interface HormigaTotals {
  subscriptionsMonthly: number;
  subscriptionsYearly: number;
  smallTotal: number;        // this month
  smallYearly: number;
  monthlyTotal: number;      // subscriptions per month + small this month
  yearlyTotal: number;
  halfYearly: number;        // what halving it frees up a year
}

export function hormigaTotals(subscriptions: SubscriptionItem[], small: SmallItem[]): HormigaTotals {
  const subscriptionsYearly = subscriptions.reduce((s, x) => s + x.yearlyAmount, 0);
  const subscriptionsMonthly = Math.round(subscriptionsYearly / 12);
  const smallTotal = small.reduce((s, x) => s + x.total, 0);
  const smallYearly = smallTotal * 12;
  const yearlyTotal = subscriptionsYearly + smallYearly;
  return {
    subscriptionsMonthly, subscriptionsYearly, smallTotal, smallYearly,
    monthlyTotal: subscriptionsMonthly + smallTotal,
    yearlyTotal,
    halfYearly: Math.round(yearlyTotal / 2),
  };
}

export interface HormigaInput {
  poolUserId: string;
  /** What the viewer may list (server/lib/visibility.ts expenseListingFilter). */
  expenseWhere: Record<string, unknown>;
  bounds: { start: Date; end: Date };
  now?: Date;
}

export interface Hormiga {
  subscriptions: (SubscriptionItem & { allocationId: string | null })[];
  small: SmallItem[];
  totals: HormigaTotals;
}

/** Subscriptions over the viewer's whole history, small frequent expenses
 *  over the period `bounds`. Only movements the viewer may list are read, so
 *  no merchant, amount or line name comes from a row hidden from them. */
export async function loadHormiga(db: PrismaClient, input: HormigaInput): Promise<Hormiga> {
  const { poolUserId, expenseWhere, bounds } = input;
  const base = { ...expenseWhere, userId: poolUserId, kind: "expense" }; // a refund isn't a charge
  const select = { merchant: true, amount: true, date: true, allocationId: true, debtId: true } as const;
  const [history, month, lineRows] = await Promise.all([
    db.expense.findMany({ where: { ...base, merchant: { not: "" } }, select, orderBy: { date: "asc" } }),
    db.expense.findMany({
      where: { ...base, date: { gte: bounds.start, lt: bounds.end }, amount: { lt: SMALL_MAX_CENTS }, debtId: null },
      select,
    }),
    db.allocation.findMany({ where: { userId: poolUserId }, select: { id: true, name: true, icon: true, type: true, debtId: true } }),
  ]);
  const lines = new Map(lineRows.map(l => [l.id, l]));
  const candidates = detectRecurringFrom(history, { now: input.now });
  const ignored = new Set((await db.recurringCommitment.findMany({
    where: { userId: poolUserId, status: "ignored", merchant: { in: candidates.map(c => c.merchant) } },
    select: { merchant: true },
  })).map(r => r.merchant));

  const debtMerchants = debtPaymentMerchants(history);
  const subscriptions = candidates
    .filter(c => !ignored.has(c.merchant) && isSubscription(c, debtMerchants, lines))
    .map(c => ({ ...subscriptionItem(c), allocationId: c.allocationId }))
    .sort((a, b) => b.yearlyAmount - a.yearlyAmount);
  const small = smallFrequentFrom(month, lines, new Set(subscriptions.map(s => s.merchant)));
  return { subscriptions, small, totals: hormigaTotals(subscriptions, small) };
}
