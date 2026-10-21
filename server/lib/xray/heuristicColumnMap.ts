// Deterministic column mapping (Fase A) — no LLM call. Tries to do what
// mapColumnsWithAI does, for the common case: header row found by vocabulary,
// then CONFIRMED against the actual cell values (dates parse as dates, amounts
// parse as numbers). A header match alone is not enough — see validateMapping
// below for why, and server/lib/xray/parseUpload.ts for where this sits in the
// chain (BBVA parser → this → AI fallback).
import { parseAmount, parseDate } from "../parsers/bbva.js";
import type { ColumnMapping } from "./aiColumnMap.js";

const DATE_HEADERS = ["fecha", "fecha valor", "fecha operacion", "fecha contable", "f valor", "date", "transaction date", "posting date"];
const CONCEPT_HEADERS = ["concepto", "descripcion", "movimiento", "observaciones", "mas datos", "detalle", "description", "details", "memo", "narrative"];
const AMOUNT_HEADERS = ["importe", "cantidad", "monto", "amount", "value"];
const DEBIT_HEADERS = ["cargo", "debito", "debe", "salida", "debit", "withdrawal", "money out"];
const CREDIT_HEADERS = ["abono", "credito", "haber", "entrada", "credit", "deposit", "money in"];
const BALANCE_HEADERS = ["disponible", "saldo", "balance", "running balance"];

const MAX_HEADER_ROWS = 25;
const HEADER_SAMPLE_ROWS = 30; // rows checked below the header to confirm the guess

function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[()€.]/g, " ").replace(/\s+/g, " ").trim();
}

function matches(cell: string, headers: string[]): boolean {
  return headers.some(h => cell === h || cell.startsWith(h + " ") || cell === h.replace(/ /g, ""));
}

function findCol(cells: string[], headers: string[], taken: Set<number>): number | null {
  for (let i = 0; i < cells.length; i++) {
    if (taken.has(i)) continue;
    if (matches(cells[i], headers)) return i;
  }
  return null;
}

// A candidate header row: needs at least a date column and one way to read an
// amount (single column, or a debit/credit pair). Mirrors the AI path's own
// minimum bar in mapColumnsWithAI.
function candidateFromRow(row: unknown[]): Omit<ColumnMapping, "headerRow"> | null {
  const cells = row.map(norm);
  const taken = new Set<number>();

  const dateCol = findCol(cells, DATE_HEADERS, taken);
  if (dateCol === null) return null;
  taken.add(dateCol);

  const conceptCol = findCol(cells, CONCEPT_HEADERS, taken);
  if (conceptCol !== null) taken.add(conceptCol);

  const amountCol = findCol(cells, AMOUNT_HEADERS, taken);
  let debitCol: number | null = null;
  let creditCol: number | null = null;
  if (amountCol !== null) {
    taken.add(amountCol);
  } else {
    debitCol = findCol(cells, DEBIT_HEADERS, taken);
    if (debitCol !== null) taken.add(debitCol);
    creditCol = findCol(cells, CREDIT_HEADERS, taken);
    if (creditCol !== null) taken.add(creditCol);
    if (debitCol === null && creditCol === null) return null;
  }

  const balanceCol = findCol(cells, BALANCE_HEADERS, taken);

  return { dateCol, conceptCol: conceptCol ?? -1, amountCol, debitCol, creditCol, balanceCol };
}

/**
 * Confirms a candidate mapping against the actual data, not just the header
 * text — a "Saldo" column mislabeled or a merged-cell export can make the
 * header guess land on the wrong column. Shared by both the heuristic and the
 * AI path (parseFile calls this on whichever mapping it gets), because a bad
 * mapping produces a financial diagnosis built on garbage regardless of which
 * path produced it.
 */
export function validateMapping(grid: unknown[][], m: ColumnMapping): boolean {
  const rows = grid.slice(m.headerRow + 1, m.headerRow + 1 + HEADER_SAMPLE_ROWS).filter(r => (r ?? []).length > 0);
  if (rows.length === 0) return false;

  let dateHits = 0;
  let amountHits = 0;
  let sawPositive = false;
  let sawNegative = false;

  for (const row of rows) {
    if (parseDate(row[m.dateCol]) !== null) dateHits++;

    let amount: number | null = null;
    if (m.amountCol !== null) {
      amount = parseAmount(row[m.amountCol]);
    } else {
      const debit = m.debitCol !== null ? parseAmount(row[m.debitCol]) : null;
      const credit = m.creditCol !== null ? parseAmount(row[m.creditCol]) : null;
      if (debit !== null || credit !== null) amount = (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount !== null) {
      amountHits++;
      if (amount > 0) sawPositive = true;
      if (amount < 0) sawNegative = true;
    }
  }

  const minRows = Math.max(1, Math.ceil(rows.length * 0.8));
  if (dateHits < minRows) return false;
  if (amountHits < minRows) return false;
  // A statement with real transaction data is expected to have both charges
  // and credits. All-same-sign is the classic symptom of having picked a
  // running-balance column (monotonic, usually all positive) instead of the
  // signed amount column — only checked for the single-amount-column case,
  // since a debit/credit pair already guarantees the sign by construction.
  if (m.amountCol !== null && rows.length >= 5 && !(sawPositive && sawNegative)) return false;

  return true;
}

export function mapColumnsHeuristically(grid: unknown[][]): ColumnMapping | null {
  for (let r = 0; r < Math.min(grid.length, MAX_HEADER_ROWS); r++) {
    const row = grid[r] ?? [];
    if (row.length === 0) continue;
    const candidate = candidateFromRow(row);
    if (!candidate) continue;

    const mapping: ColumnMapping = { headerRow: r, ...candidate };
    if (validateMapping(grid, mapping)) return mapping;
  }
  return null;
}
