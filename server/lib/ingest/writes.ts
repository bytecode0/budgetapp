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

export function planImportWrites(rows: ConfirmRow[], ctx: WriteContext): WritePlan {
  if (rows.some(r => !r || !IMPORT_KINDS.has(r.kind))) return { error: "Invalid row kind", status: 400 };
  if (rows.some(r => !Number.isSafeInteger(r.amountCents) || r.amountCents <= 0)) return { error: "Invalid amount", status: 400 };

  const lineById = new Map(ctx.debtLines.map(l => [l.id, l]));
  const lineByDebt = new Map(ctx.debtLines.map(l => [l.debtId, l.id]));
  const debtById = new Map(ctx.debts.map(d => [d.id, d]));
  const common = (r: ConfirmRow): Common => ({
    amount: r.amountCents,
    description: r.description ?? "",
    merchant: r.merchant || normalizeMerchant(r.description ?? ""),
    externalId: r.externalId,
    date: new Date(r.date),
  });

  const expenses: ExpenseWrite[] = [];
  const incomes: IncomeWrite[] = [];
  for (const r of rows) {
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
        if (!debt) return { error: "Debt not found", status: 404 };
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
        if (r.allocationId && lineById.has(r.allocationId)) return { error: "A refund can't go on a debt line", status: 400 };
        expenses.push({ ...common(r), kind: "refund", accountId: ctx.accountId, allocationId: r.allocationId || null, debtId: null });
        break;
    }
  }
  return { expenses, incomes };
}
