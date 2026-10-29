// Cell values → SHAPES, for the AI column mapping (privacy: no amount, date,
// description or name ever leaves the browser for an AI). Pure; runs in Node
// and browser. The browser computes the shapes; the server re-validates them
// with the same grammar before anything reaches a model.
//
//   ""             → EMPTY
//   "29/10/2026"   → dd/mm/yyyy   ("03/04/2026" → nn/nn/yyyy: either order)
//   "2026-10-29"   → yyyy-mm-dd
//   "-1.234,56"    → -#.###,##    ("12.50 EUR" → #.## CUR)
//   45231 (Excel)  → INT          (-12.5 → -DEC)
//   "EUR"          → CODE3
//   "MERCADONA SA" → TEXT(12)
//
// Shapes carry no digit except the length inside TEXT(n): the validator
// rejects anything else, so a raw value can't be smuggled through.
import { normHeader } from "./columns.js";

export const MAX_SHAPE_COLUMNS = 30;
export const MAX_SHAPE_ROWS = 10;
export const MAX_HEADER_LENGTH = 40;
const MAX_SHAPE_LENGTH = 24;

const DATE = /^(\d{1,4})([/.-])(\d{1,2})\2(\d{1,4})(?:[ T](\d{1,2}):(\d{2})(?::\d{2})?)?$/;
const NUMBER = /^([+\-(]?)\s*([€$£]?)\s*([+-]?)(\d[\d.,'  ]*?)\s*([€$£]?)\s*([-)]?)\s*([A-Z]{3})?$/;

function dateShape(m: RegExpExecArray): string | null {
  const [, a, sep, b, c, hh] = m;
  const time = hh !== undefined ? " hh:mm" : "";
  if (a.length === 4) return `yyyy${sep}mm${sep}dd${time}`;
  if (c.length !== 4 && c.length !== 2) return null;
  const year = c.length === 4 ? "yyyy" : "yy";
  const first = +a > 12 ? "dd" : +b > 12 ? "mm" : "nn";
  const second = first === "dd" ? "mm" : first === "mm" ? "dd" : "nn";
  return `${first}${sep}${second}${sep}${year}${time}`;
}

function numberShape(m: RegExpExecArray): string {
  const [, lead, cur1, sign, core, cur2, trail, code] = m;
  const negative = lead === "-" || lead === "(" || sign === "-" || trail === "-" || trail === ")";
  const digits = core.replace(/ /g, " ").trim();
  const seps = [...digits.matchAll(/[.,' ]/g)].map(x => x[0]);
  let body = "#";
  if (seps.length > 0) {
    const last = seps[seps.length - 1];
    const tail = digits.slice(digits.lastIndexOf(last) + 1).length;
    const otherKinds = seps.filter(s => s !== last);
    if (otherKinds.length > 0) body = `#${otherKinds[0]}###${last}${"#".repeat(Math.min(tail, 3) || 1)}`;
    else if (seps.length > 1 || tail === 3) body = `#${last}###`;
    else body = `#${last}${"#".repeat(Math.min(tail, 3) || 1)}`;
  }
  const currency = cur1 || cur2 || code ? " CUR" : "";
  return `${negative ? "-" : ""}${body}${currency}`;
}

/** The shape of one cell: its format, never its value. */
export function cellShape(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "TEXT(1)";
    return `${v < 0 ? "-" : ""}${Number.isInteger(v) ? "INT" : "DEC"}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return "EMPTY";
  const d = DATE.exec(s);
  if (d) { const shape = dateShape(d); if (shape) return shape; }
  const n = NUMBER.exec(s);
  if (n) return numberShape(n);
  if (/^[A-Z]{3}$/.test(s)) return "CODE3";
  return `TEXT(${Math.min(s.length, 999)})`;
}

const SHAPE = new RegExp(
  "^(?:EMPTY|CODE3|TEXT\\([1-9]\\d{0,2}\\)|-?(?:INT|DEC)"
  + "|(?:dd|mm|nn|yyyy|yy)[/.-](?:dd|mm|nn)[/.-](?:yyyy|yy|dd)(?: hh:mm)?"
  + "|-?#(?:[.,' ]#{1,3})*(?: CUR)?)$",
);

export const isShape = (s: unknown): s is string => typeof s === "string" && s.length <= MAX_SHAPE_LENGTH && SHAPE.test(s);

/** Column titles are short; a longer text is more likely a description. */
const MAX_HEADER_WORDS = 4;

/** A header that is really a value (a date, an amount, an id, an email, a
 *  long text…) — what a wrongly chosen header row would send. */
export function headerLooksLikeValue(h: string): boolean {
  if (h.length > MAX_HEADER_LENGTH || /\d{3,}/.test(h) || h.includes("@")) return true;
  if (h.trim().split(/\s+/).length > MAX_HEADER_WORDS) return true;
  return !/^(?:EMPTY|CODE3|TEXT\(\d+\))$/.test(cellShape(h));
}

export interface ShapeInput {
  headers: string[];
  shapes: string[][];
}

/** What the browser sends for a mapping suggestion: the header row's labels
 *  (a header that looks like a value goes as "") and the shapes of the first
 *  data rows under it. */
export function shapesFromSample(rows: string[][], headerRow: number): ShapeInput {
  const header = (rows[headerRow] ?? []).slice(0, MAX_SHAPE_COLUMNS).map(h => String(h ?? "").trim());
  const headers = header.map(h => (headerLooksLikeValue(h) ? "" : h));
  const shapes = rows.slice(headerRow + 1)
    .filter(r => (r ?? []).some(c => String(c ?? "").trim()))
    .slice(0, MAX_SHAPE_ROWS)
    .map(r => headers.map((_, i) => cellShape(r?.[i])));
  return { headers, shapes };
}

/** Server side: the same input, re-validated strictly. Anything that isn't a
 *  header label or a shape is refused — never trimmed into one. */
export function parseShapeInput(input: unknown): { input: ShapeInput } | { error: string } {
  const o = input as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "body must be an object" };
  const { headers, shapes } = o as { headers?: unknown; shapes?: unknown };
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > MAX_SHAPE_COLUMNS) return { error: "headers must be a list of 1 to 30" };
  if (headers.some(h => typeof h !== "string" || (h !== "" && headerLooksLikeValue(h)))) return { error: "headers must be column titles, not values" };
  if (!headers.some(h => normHeader(h))) return { error: "headers are all empty" };
  if (!Array.isArray(shapes) || shapes.length === 0 || shapes.length > MAX_SHAPE_ROWS) return { error: "shapes must be a list of 1 to 10 rows" };
  for (const row of shapes) {
    if (!Array.isArray(row) || row.length !== headers.length || !row.every(isShape)) return { error: "shapes must be cell formats, one per header" };
  }
  return { input: { headers: headers as string[], shapes: shapes as string[][] } };
}
