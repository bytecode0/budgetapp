// Grid → NormalizedRow[] through a ColumnMapping. Pure; runs in Node and browser.
//
// - findHeaderRow(): the first row (of the first 30) where a mapping's columns
//   are all present — banks put titles, holder and dates above the table.
// - detectMapping(): builds a mapping from header SYNONYMS (Spanish and
//   English) when no bank profile or saved mapping applies.
// - applyMapping(): reads the rows below the header.
import { parseDay } from "./dates.js";
import { detectDecimal, parseAmountCents } from "./numbers.js";
import type { ColumnMapping, NormalizedRow, SkippedRow } from "./types.js";

/** Header text in comparable form: no accents/case/punctuation. "F.Valor" → "f valor". */
export function normHeader(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// In PRIORITY order: the first synonym found in the header row wins, so
// "fecha" (operation date) beats "f valor" (value date) when both exist.
export const SYNONYMS = {
  date: [
    "fecha", "fecha operacion", "fecha de operacion", "f operacion", "fecha transaccion", "fecha contable",
    "fecha valor", "f valor", "date", "transaction date", "booking date", "posted date", "posting date",
    "started date", "value date", "completed date",
  ],
  amount: ["importe", "importe eur", "importe euros", "cantidad", "monto", "amount", "transaction amount", "value"],
  debit: ["cargo", "cargos", "debe", "debito", "adeudo", "salidas", "debit", "withdrawal", "withdrawals", "money out", "paid out"],
  credit: ["abono", "abonos", "haber", "credito", "ingresos", "entradas", "credit", "deposit", "deposits", "money in", "paid in"],
  description: [
    "concepto", "descripcion", "movimiento", "observaciones", "mas datos", "detalle", "detalles", "comercio",
    "beneficiario", "description", "details", "merchant", "payee", "memo", "narrative", "reference", "name",
  ],
  balance: ["saldo", "disponible", "saldo disponible", "balance", "running balance"],
  currency: ["divisa", "moneda", "currency"],
  state: ["estado", "state", "status"],
  fee: ["comision", "fee", "fees"],
} as const;

/** Index of the column whose header is `label` (compared normalised), or -1. */
export function columnIndex(headerRow: unknown[], label: string | undefined): number {
  if (!label) return -1;
  const want = normHeader(label);
  return headerRow.findIndex(c => normHeader(c) === want);
}

function mappingColumnsPresent(headerRow: unknown[], m: ColumnMapping): boolean {
  if (columnIndex(headerRow, m.date) < 0) return false;
  const hasAmount = m.amount ? columnIndex(headerRow, m.amount) >= 0 : false;
  const hasSplit = (m.debit ? columnIndex(headerRow, m.debit) >= 0 : false)
    || (m.credit ? columnIndex(headerRow, m.credit) >= 0 : false);
  if (!hasAmount && !hasSplit) return false;
  return m.description.length === 0 || m.description.some(d => columnIndex(headerRow, d) >= 0);
}

export function findHeaderRow(grid: unknown[][], m: ColumnMapping): number {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    if (mappingColumnsPresent(grid[r] ?? [], m)) return r;
  }
  return -1;
}

/** A mapping from header synonyms, or null when no row has a date and an amount. */
export function detectMapping(grid: unknown[][]): { headerRow: number; mapping: ColumnMapping } | null {
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const row = grid[r] ?? [];
    const cells = row.map(normHeader);
    const first = (names: readonly string[]): string | undefined => {
      for (const n of names) {
        const i = cells.indexOf(n);
        if (i >= 0) return String(row[i]);
      }
      // "Importe (EUR)", "Fecha operación 2026"…: a synonym followed by more words.
      for (const n of names) {
        const i = cells.findIndex(c => c.startsWith(n + " "));
        if (i >= 0) return String(row[i]);
      }
      return undefined;
    };
    const date = first(SYNONYMS.date);
    const amount = first(SYNONYMS.amount);
    const debit = first(SYNONYMS.debit);
    const credit = first(SYNONYMS.credit);
    if (!date || (!amount && !debit && !credit)) continue;
    const description = cells.flatMap((c, i) => ((SYNONYMS.description as readonly string[]).includes(c) ? [String(row[i])] : []));
    return {
      headerRow: r,
      mapping: {
        date,
        ...(amount ? { amount } : { debit, credit }),
        description,
        balance: first(SYNONYMS.balance),
        currency: first(SYNONYMS.currency),
        state: first(SYNONYMS.state),
        fee: first(SYNONYMS.fee),
      },
    };
  }
  return null;
}

/** Joins detail cells, dropping repeats (BBVA's Observaciones is usually the
 *  uppercased Movimiento; a merchant repeated twice mangles its key). */
function detailParts(row: unknown[], cols: number[]): string[] {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const ci of cols) {
    const v = String(row[ci] ?? "").trim();
    if (!v) continue;
    const key = normHeader(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parts.push(v);
  }
  return parts;
}

/** Reads every row under `headerRow` with the mapping. Rows without a date or
 *  an amount (totals, footers, blank lines) are skipped silently — they aren't
 *  movements; rows the source marks as not settled are reported as skipped. */
export function applyMapping(grid: unknown[][], headerRow: number, m: ColumnMapping): { rows: NormalizedRow[]; skipped: SkippedRow[] } {
  const header = grid[headerRow] ?? [];
  const col = (label?: string) => columnIndex(header, label);
  const c = {
    date: col(m.date), amount: col(m.amount), debit: col(m.debit), credit: col(m.credit),
    balance: col(m.balance), currency: col(m.currency), state: col(m.state), fee: col(m.fee),
    description: m.description.map(col).filter(i => i >= 0),
  };
  const body = grid.slice(headerRow + 1);
  const columnDecimal = (i: number) => (i < 0 ? null : detectDecimal(body.map(r => r?.[i])));
  const decimal = m.decimal ?? columnDecimal(c.amount >= 0 ? c.amount : c.debit >= 0 ? c.debit : c.credit)
    ?? columnDecimal(c.balance);

  const rows: NormalizedRow[] = [];
  const skipped: SkippedRow[] = [];
  body.forEach((row, rowIndex) => {
    row = row ?? [];
    const date = parseDay(row[c.date], m.dateOrder);
    let amountCents: number | null = null;
    if (c.amount >= 0) {
      amountCents = parseAmountCents(row[c.amount], decimal);
    } else {
      const out = c.debit >= 0 ? parseAmountCents(row[c.debit], decimal) : null;
      const inn = c.credit >= 0 ? parseAmountCents(row[c.credit], decimal) : null;
      if (out) amountCents = -Math.abs(out);
      else if (inn) amountCents = Math.abs(inn);
      else if (out === 0 || inn === 0) amountCents = 0;
    }
    if (!date || amountCents === null) return;

    const state = c.state >= 0 ? String(row[c.state] ?? "").trim() || null : null;
    if (state && !/^(completed?|completad[oa]|ok|settled|booked|liquidad[oa])$/i.test(state)) {
      skipped.push({ rowIndex, reason: `state:${state.toUpperCase()}` });
      return;
    }

    const parts = detailParts(row, c.description);
    const fee = c.fee >= 0 ? parseAmountCents(row[c.fee], decimal) : null;
    const currency = c.currency >= 0 ? String(row[c.currency] ?? "").trim().toUpperCase() || null : null;
    rows.push({
      rowIndex,
      date,
      amountCents,
      description: parts[0] ?? "",
      details: parts.slice(1).join(" ") || undefined,
      balanceCents: c.balance >= 0 ? parseAmountCents(row[c.balance], decimal) : null,
      currency,
      state,
      feeCents: fee ? -Math.abs(fee) : null,
    });
  });
  return { rows, skipped };
}
