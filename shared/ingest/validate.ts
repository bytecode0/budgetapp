// Untrusted input → ingest shapes. Used for what a client sends: a column
// mapping to save on an account (Account.importProfile), and the rows (plus
// skipped rows and source) the browser already read (decision O). Pure.
import { makeDay } from "./dates.js";
import { cellShape, isValueShape } from "./shapes.js";
import type { ColumnMapping, NormalizedRow, SkippedRow, StatementSource } from "./types.js";

const MAX_LABEL = 120;
const MAX_ROWS = 20000;

const label = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() && v.length <= MAX_LABEL ? v.trim() : undefined;

/** A valid ColumnMapping, or an error message naming what's wrong. */
export function parseColumnMapping(input: unknown): { mapping: ColumnMapping } | { error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "mapping must be an object" };
  const o = input as Record<string, unknown>;
  const date = label(o.date);
  if (!date) return { error: "mapping.date is required" };
  const amount = label(o.amount), debit = label(o.debit), credit = label(o.credit);
  if (!amount && !debit && !credit) return { error: "mapping needs amount, or debit/credit" };
  if (!Array.isArray(o.description) || o.description.length > 5) return { error: "mapping.description must be a list of up to 5 columns" };
  const description = o.description.map(label);
  if (description.some(d => d === undefined)) return { error: "mapping.description has an invalid column" };
  for (const k of ["balance", "currency", "state", "fee"] as const) {
    if (o[k] !== undefined && o[k] !== null && !label(o[k])) return { error: `mapping.${k} is invalid` };
  }
  if (o.dateOrder !== undefined && !["dmy", "mdy", "ymd"].includes(o.dateOrder as string)) return { error: "mapping.dateOrder is invalid" };
  if (o.decimal !== undefined && o.decimal !== "," && o.decimal !== ".") return { error: "mapping.decimal is invalid" };
  if (o.purchasesSign !== undefined && o.purchasesSign !== "negative" && o.purchasesSign !== "positive") {
    return { error: "mapping.purchasesSign is invalid" };
  }
  // Columns are named by their title: a date or an amount as a "title" means
  // a data row was taken for the header row.
  const labels = [date, amount, debit, credit, ...description, ...["balance", "currency", "state", "fee"].map(k => label(o[k]))];
  if (labels.some(l => l !== undefined && isValueShape(cellShape(l)))) return { error: "mapping columns must be column titles, not values" };
  const mapping: ColumnMapping = {
    date,
    ...(amount ? { amount } : {}),
    ...(!amount && debit ? { debit } : {}),
    ...(!amount && credit ? { credit } : {}),
    description: description as string[],
    ...(label(o.balance) ? { balance: label(o.balance) } : {}),
    ...(label(o.currency) ? { currency: label(o.currency) } : {}),
    ...(label(o.state) ? { state: label(o.state) } : {}),
    ...(label(o.fee) ? { fee: label(o.fee) } : {}),
    ...(o.dateOrder ? { dateOrder: o.dateOrder as ColumnMapping["dateOrder"] } : {}),
    ...(o.decimal ? { decimal: o.decimal as ColumnMapping["decimal"] } : {}),
    ...(o.purchasesSign ? { purchasesSign: o.purchasesSign as ColumnMapping["purchasesSign"] } : {}),
  };
  return { mapping };
}

/** A stored mapping (Json column) read back; null when absent or unusable. */
export function storedMapping(json: unknown): ColumnMapping | null {
  if (json === null || json === undefined) return null;
  const r = parseColumnMapping(json);
  return "mapping" in r ? r.mapping : null;
}

const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && makeDay(+v.slice(0, 4), +v.slice(5, 7), +v.slice(8, 10)) === v;
const optInt = (v: unknown) => v === undefined || v === null || Number.isSafeInteger(v);
const optStr = (v: unknown, max = 500) => v === undefined || v === null || (typeof v === "string" && v.length <= max);

/** What the browser posts: the reader's rows within the bounds the server
 *  checks (parseNormalizedRows), so a long text or an odd currency cell in a
 *  bank's export can't make the whole import fail. Texts are cut, not
 *  dropped; a currency that isn't a 3-letter code is unknown. */
export function toWireRows(rows: NormalizedRow[]): NormalizedRow[] {
  const cut = (v: string | null | undefined, max: number) => (typeof v === "string" ? v.slice(0, max) : v);
  return rows.map(r => ({
    ...r,
    description: r.description.slice(0, 500),
    details: cut(r.details, 500) ?? undefined,
    externalRef: cut(r.externalRef, 200),
    state: cut(r.state, 40),
    currency: r.currency && /^[A-Z]{3}$/.test(r.currency) ? r.currency : null,
  }));
}

/** Skipped rows as the browser posts them (a reason within parseSkippedRows' bound). */
export const toWireSkipped = (skipped: SkippedRow[]): SkippedRow[] =>
  skipped.map(s => ({ rowIndex: s.rowIndex, reason: s.reason.slice(0, 60) }));

/** Rows read in the browser, checked as strictly as the server's own reader
 *  would produce them: integer cents, real calendar days, bounded text. */
export function parseNormalizedRows(input: unknown): { rows: NormalizedRow[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: "rows must be a non-empty list" };
  if (input.length > MAX_ROWS) return { error: `at most ${MAX_ROWS} rows per import` };
  const rows: NormalizedRow[] = [];
  for (const [i, raw] of input.entries()) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== "object") return { error: `row ${i}: not an object` };
    if (!isDay(r.date)) return { error: `row ${i}: date must be yyyy-mm-dd` };
    if (!Number.isSafeInteger(r.amountCents)) return { error: `row ${i}: amountCents must be an integer` };
    if (typeof r.description !== "string" || r.description.length > 500) return { error: `row ${i}: invalid description` };
    if (!optStr(r.details) || !optStr(r.externalRef, 200) || !optStr(r.currency, 3) || !optStr(r.state, 40)) {
      return { error: `row ${i}: invalid text field` };
    }
    if (!optInt(r.balanceCents) || !optInt(r.feeCents)) return { error: `row ${i}: cents must be integers` };
    rows.push({
      rowIndex: i,
      date: r.date,
      amountCents: r.amountCents as number,
      description: r.description,
      details: (r.details as string | undefined) ?? undefined,
      balanceCents: (r.balanceCents as number | null | undefined) ?? null,
      externalRef: (r.externalRef as string | null | undefined) ?? null,
      currency: (r.currency as string | null | undefined) ?? null,
      state: (r.state as string | null | undefined) ?? null,
      feeCents: r.feeCents ? -Math.abs(r.feeCents as number) : null,
    });
  }
  return { rows };
}

/** Rows the browser's reader left out (pending, declined…), shown in the
 *  preview with their reason. Absent → none. */
export function parseSkippedRows(input: unknown): { skipped: SkippedRow[] } | { error: string } {
  if (input === undefined || input === null) return { skipped: [] };
  if (!Array.isArray(input) || input.length > MAX_ROWS) return { error: `skipped must be a list of up to ${MAX_ROWS}` };
  const skipped: SkippedRow[] = [];
  for (const [i, raw] of input.entries()) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || !Number.isSafeInteger(r.rowIndex) || (r.rowIndex as number) < 0
      || typeof r.reason !== "string" || !r.reason || r.reason.length > 60) {
      return { error: `skipped ${i}: invalid` };
    }
    skipped.push({ rowIndex: r.rowIndex as number, reason: r.reason });
  }
  return { skipped };
}

const SOURCES: StatementSource[] = ["bbva", "revolut", "generic", "mapping", "norma43", "ofx", "rows"];

/** Which reader understood the file, as the browser reports it; "rows" when unsaid. */
export function parseSource(input: unknown): StatementSource | null {
  if (input === undefined || input === null) return "rows";
  return SOURCES.includes(input as StatementSource) ? (input as StatementSource) : null;
}
