// Confirmed import rows → the Expense / Income records to write. Pure: the
// confirm route (/api/expenses/import/confirm) loads the context and writes
// the plan; the money tests replay the same plan through debtBalance.
//
//   expense → Expense in its category. On a "debt" line it's a payment of that
//             debt (debtId inherited from the line, as for manual expenses) —
//             rejected when the account is that card itself.
//   payment → Expense with the row's debtId, on that debt's line. From the
//             card's own statement the paying account isn't known: accountId
//             null (a card can't pay itself).
//   refund  → Expense kind "refund" (positive amount, counts negative: lowers
//             its category's spending and, on a card, the debt). Never on a
//             debt line.
//   income  → Income.
import { normalizeMerchant } from "../normalizeMerchant.js";
import { makeDay } from "../../../shared/ingest/dates.js";

export const IMPORT_KINDS = new Set(["expense", "income", "payment", "refund"]);

export interface ConfirmRow {
  kind: string;
  externalId: string;
  date: string;
  description?: string;
  merchant?: string;
  amountCents: number; // positive
  allocationId?: string | null;
  category?: string;
  debtId?: string | null;
}

export interface WriteContext {
  /** Today ("yyyy-mm-dd"): dates more than a year ahead are rejected. */
  today: string;
  accountId: string | null;
  /** The pool's "debt" budget lines. */
  debtLines: { id: string; debtId: string; debtAccountId: string | null }[];
  /** The pool's debts (payments must name one of them). */
  debts: { id: string; accountId: string | null }[];
}

interface Common {
  amount: number;
  description: string;
  merchant: string;
  externalId: string;
  date: Date;
}
export interface ExpenseWrite extends Common {
  kind: "expense" | "refund";
  accountId: string | null;
  allocationId: string | null;
  debtId: string | null;
}
export interface IncomeWrite extends Common {
  accountId: string | null;
  category: string;
}

export type WritePlan =
  | { expenses: ExpenseWrite[]; incomes: IncomeWrite[] }
  | { error: string; code?: string; status: number };

export const PAID_FROM_CARD = { error: "A card payment must come from another account, not the card itself", code: "paid_from_card" };
export const REFUND_ON_DEBT_LINE = { error: "A refund can't go on a debt line", code: "refund_on_debt_line" };

/** Why an Expense of `kind` paid from `accountId` can't sit on the debt line
 *  of `debt` (null = not a debt line), or null when it can: a refund never
 *  pays a debt, and a card never pays itself. Used by every write path. */
export function debtLineError(
  kind: string | null | undefined,
  debt: { accountId: string | null } | null,
  accountId: string | null,
): { error: string; code: string } | null {
  if (!debt) return null;
  if (kind === "refund") return REFUND_ON_DEBT_LINE;
  if (debt.accountId && debt.accountId === accountId) return PAID_FROM_CARD;
  return null;
}

/** Amounts are Int columns (Postgres int4). */
export const MAX_AMOUNT_CENTS = 2_147_483_647;
const MAX_EXTERNAL_ID = 200;
const MAX_TEXT = 500;
const MIN_DAY = "1990-01-01";

const addDays = (day: string, n: number) =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);

/** A real calendar day "yyyy-mm-dd" between 1990 and a year from today. */
export function isImportDay(v: unknown, today: string): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && makeDay(+v.slice(0, 4), +v.slice(5, 7), +v.slice(8, 10)) === v
    && v >= MIN_DAY && v <= addDays(today, 366);
}

const optText = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.length <= MAX_TEXT);

export function planImportWrites(rows: ConfirmRow[], ctx: WriteContext): WritePlan {
  if (rows.some(r => !r || typeof r !== "object" || !IMPORT_KINDS.has(r.kind))) return { error: "Invalid row kind", code: "invalid_rows", status: 400 };
  if (rows.some(r => !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0 || r.amountCents > MAX_AMOUNT_CENTS)) {
    return { error: "Invalid amount", code: "invalid_rows", status: 400 };
  }
  if (rows.some(r => !isImportDay(r.date, ctx.today))) return { error: "Invalid date", code: "invalid_rows", status: 400 };
  if (rows.some(r => typeof r.externalId !== "string" || !r.externalId || r.externalId.length > MAX_EXTERNAL_ID)) {
    return { error: "Invalid externalId", code: "invalid_rows", status: 400 };
  }
  if (rows.some(r => !optText(r.description) || !optText(r.merchant))) return { error: "Invalid text", code: "invalid_rows", status: 400 };

  const lineById = new Map(ctx.debtLines.map(l => [l.id, l]));
  const lineByDebt = new Map(ctx.debtLines.map(l => [l.debtId, l.id]));
  const debtById = new Map(ctx.debts.map(d => [d.id, d]));
  const common = (r: ConfirmRow): Common => ({
    amount: r.amountCents,
    description: r.description ?? "",
    merchant: r.merchant || normalizeMerchant(r.description ?? ""),
    externalId: r.externalId,
    date: new Date(r.date), // a calendar day: midnight UTC, as the reader's days
  });

  const expenses: ExpenseWrite[] = [];
  const incomes: IncomeWrite[] = [];
  // One movement per id: a row sent twice (a repeated OFX FITID, a double
  // submit) is written once — the database would skip it anyway, but it must
  // not count twice towards a life plan either.
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.externalId)) continue;
    seen.add(r.externalId);
    switch (r.kind) {
      case "income":
        incomes.push({ ...common(r), accountId: ctx.accountId, category: r.category || "other" });
        break;
      case "expense": {
        const line = r.allocationId ? lineById.get(r.allocationId) : undefined;
        if (line && line.debtAccountId && line.debtAccountId === ctx.accountId) return { ...PAID_FROM_CARD, status: 400 };
        expenses.push({ ...common(r), kind: "expense", accountId: ctx.accountId, allocationId: r.allocationId || null, debtId: line?.debtId ?? null });
        break;
      }
      case "payment": {
        const debt = r.debtId ? debtById.get(r.debtId) : undefined;
        if (!debt) return { error: "Debt not found", code: "debt_not_found", status: 404 };
        expenses.push({
          ...common(r),
          kind: "expense",
          accountId: debt.accountId && debt.accountId === ctx.accountId ? null : ctx.accountId,
          allocationId: lineByDebt.get(debt.id) ?? null,
          debtId: debt.id,
        });
        break;
      }
      case "refund":
        if (r.allocationId && lineById.has(r.allocationId)) return { ...REFUND_ON_DEBT_LINE, status: 400 };
        expenses.push({ ...common(r), kind: "refund", accountId: ctx.accountId, allocationId: r.allocationId || null, debtId: null });
        break;
    }
  }
  return { expenses, incomes };
}
