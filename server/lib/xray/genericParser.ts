// Generic statement parser (R2) driven by a ColumnMapping (from the AI fallback).
// Reuses the BBVA parser's battle-tested amount/date parsing so Spanish number
// and date formats are handled identically regardless of bank.
import { parseAmount, parseDate, type ParsedTxn } from "../parsers/bbva.js";
import type { ColumnMapping } from "./aiColumnMap.js";

export function gridToTransactionsGeneric(grid: unknown[][], m: ColumnMapping): ParsedTxn[] {
  const out: ParsedTxn[] = [];
  for (let r = m.headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = parseDate(row[m.dateCol]);
    if (!date) continue;

    let amount: number | null;
    if (m.amountCol !== null) {
      amount = parseAmount(row[m.amountCol]);
    } else {
      // Debit (money out) / credit (money in) as magnitudes → one signed amount.
      const debit = m.debitCol !== null ? parseAmount(row[m.debitCol]) : null;
      const credit = m.creditCol !== null ? parseAmount(row[m.creditCol]) : null;
      if (debit === null && credit === null) { amount = null; }
      else { amount = (credit ?? 0) - Math.abs(debit ?? 0); }
    }
    if (amount === null) continue; // skip blanks / totals / footers

    out.push({
      date,
      amount,
      concept: m.conceptCol >= 0 ? String(row[m.conceptCol] ?? "").trim() : "",
      balance: m.balanceCol !== null ? parseAmount(row[m.balanceCol]) : null,
    });
  }
  return out;
}
