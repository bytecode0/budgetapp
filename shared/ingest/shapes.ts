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
import { normHeader, SYNONYMS } from "./columns.js";

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

// Only what cellShape() can produce: a date with one separator and the year
// last (or first, ISO); an amount with at most a thousands and a decimal
// separator.
const SHAPE = new RegExp(
  "^(?:EMPTY|CODE3|TEXT\\([1-9]\\d{0,2}\\)|-?(?:INT|DEC)"
  + "|(?:yyyy([/.-])mm\\1dd|(?:dd|mm|nn)([/.-])(?:dd|mm|nn)\\2(?:yyyy|yy))(?: hh:mm)?"
  + "|-?#(?:[.,' ]###)?(?:[.,' ]#{1,3})?(?: CUR)?)$",
);

export const isShape = (s: unknown): s is string => typeof s === "string" && s.length <= MAX_SHAPE_LENGTH && SHAPE.test(s);

/** A shape only a value has (a date, an amount, a number) — never a column title. */
export const isValueShape = (shape: string): boolean => !/^(?:EMPTY|CODE3|TEXT\(\d+\))$/.test(shape);

/** Column titles are short; a longer text is more likely a description. */
const MAX_HEADER_WORDS = 4;

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "a", "al", "en", "y", "e", "o", "of", "the", "in", "out", "to", "and", "por", "con", "n"]);

/** Words that column titles are made of: the synonyms the reader knows plus
 *  common titles of statement exports that it doesn't map. */
const HEADER_WORDS = new Set([
  ...Object.values(SYNONYMS).flat().flatMap(s => s.split(" ")),
  "tipo", "type", "numero", "number", "tarjeta", "card", "producto", "product", "categoria", "category",
  "referencia", "ref", "codigo", "code", "cuenta", "account", "hora", "time", "oficina", "office", "titular",
  "holder", "banco", "bank", "pais", "country", "ciudad", "city", "nota", "notas", "notes", "note", "cambio",
  "exchange", "rate", "tasa", "operacion", "operation", "original", "total", "id", "iban", "bic",
].filter(w => !STOPWORDS.has(w)));

/** A cell that is one of the reader's header synonyms ("Fecha", "Importe (EUR)"…). */
export function isKnownHeader(cell: unknown): boolean {
  const c = normHeader(cell);
  if (!c) return false;
  return Object.values(SYNONYMS).some(names => names.some(n => c === n || c.startsWith(n + " ")));
}

/** A title that is really a value or personal data (a date, an amount, an id,
 *  an email, a long text, a person's or shop's name…) — what a wrongly chosen
 *  header row would send. Best effort: the user also sees the titles before
 *  they're sent. */
export function headerLooksLikeValue(h: string): boolean {
  if (h.length > MAX_HEADER_LENGTH || h.includes("@") || /\((?:at)\)|\[(?:at)\]/i.test(h)) return true;
  if ((h.match(/\d/g) ?? []).length >= 3 || /\.(?:com|es|net|org|eu)\b/i.test(h)) return true;
  if (h.trim().split(/\s+/).length > MAX_HEADER_WORDS) return true;
  if (isValueShape(cellShape(h))) return true;
  // Two or more capitalised words and no title vocabulary: a name
  // ("Ana López Ruiz", "BIZUM DE JUAN PEREZ"), not a column title.
  const capitalised = h.split(/[^\p{L}]+/u).filter(w => w.length >= 2 && !STOPWORDS.has(w.toLowerCase()) && /^\p{Lu}/u.test(w));
  const known = normHeader(h).split(" ").some(w => HEADER_WORDS.has(w));
  return capitalised.length >= 2 && !known;
}

type ShapeClass = "TEXT" | "CODE3" | "DATE" | "NUMBER";
function shapeClass(shape: string): ShapeClass | null {
  if (shape === "EMPTY") return null;
  if (shape.startsWith("TEXT(")) return "TEXT";
  if (shape === "CODE3") return "CODE3";
  return /y/.test(shape) ? "DATE" : "NUMBER";
}

/** Whether a row reads like the rows below it: most of its filled cells have
 *  the format their column has below. */
export function rowLooksLikeData(rowShapes: string[], below: string[][]): boolean {
  let compared = 0, same = 0;
  rowShapes.forEach((shape, i) => {
    const mine = shapeClass(shape);
    if (!mine) return;
    const counts = new Map<ShapeClass, number>();
    for (const r of below) {
      const c = shapeClass(r[i] ?? "EMPTY");
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    if (counts.size === 0) return;
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    compared++;
    if (top === mine) same++;
  });
  return compared > 0 && same * 2 > compared;
}

/** Why a row can't be the header row, or null when it can be:
 *  - "empty": no title at all;
 *  - "values": a cell is a date, an amount or a number;
 *  - "data": its cells have the formats of the rows below (a data row).
 *  Shared by the browser (before the AI suggestion and before saving a
 *  mapping) and the server (before the AI suggestion). */
export type HeaderRowProblem = "empty" | "values" | "data";
export function headerRowProblem(labels: string[], labelShapes: string[], below: string[][]): HeaderRowProblem | null {
  if (!labels.some(l => normHeader(l))) return "empty";
  if (labelShapes.some(isValueShape)) return "values";
  // Two of the reader's known titles: a header, whatever the rows below hold
  // (dates written as text would otherwise look like the titles' format).
  if (labels.filter(isKnownHeader).length >= 2) return null;
  return rowLooksLikeData(labelShapes, below) ? "data" : null;
}

const nonEmptyRows = (rows: unknown[][]) => rows.filter(r => (r ?? []).some(c => String(c ?? "").trim()));

/** The header-row check on a sample's grid (`headerRow` -1: none chosen). */
export function sampleHeaderProblem(rows: string[][], headerRow: number): HeaderRowProblem | null {
  if (headerRow < 0 || headerRow >= rows.length) return "empty";
  const labels = (rows[headerRow] ?? []).map(h => String(h ?? "").trim());
  const below = nonEmptyRows(rows.slice(headerRow + 1)).slice(0, MAX_SHAPE_ROWS).map(r => labels.map((_, i) => cellShape(r?.[i])));
  return headerRowProblem(labels, labels.map(cellShape), below);
}

/** The header row a person would pick, or -1 when no row can be one. Rows
 *  with values, or that read like the data, never qualify; among the rest,
 *  the reader's known titles count double, then the fullest row wins (title
 *  and holder lines above a table have fewer cells than its header). */
export function guessHeaderRow(rows: string[][]): number {
  let best = -1, bestScore = -1;
  rows.forEach((r, i) => {
    if (sampleHeaderProblem(rows, i)) return;
    const filled = r.filter(c => String(c ?? "").trim());
    const score = filled.length + 2 * filled.filter(isKnownHeader).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

export interface ShapeInput {
  headers: string[];
  /** The header row's own formats: the server re-checks them. */
  headerShapes: string[];
  shapes: string[][];
}

/** Why nothing can be sent for a suggestion: the row isn't a header row, or
 *  some of its titles look like values or personal data. */
export type SampleProblem = HeaderRowProblem | "titles";

/** What the browser sends for a mapping suggestion: the header row's titles
 *  as they are, their formats and the formats of the first data rows — or,
 *  when that row fails the header checks, nothing at all. */
export function shapesFromSample(rows: string[][], headerRow: number): { input: ShapeInput } | { problem: SampleProblem } {
  const problem = sampleHeaderProblem(rows, headerRow);
  if (problem) return { problem };
  const headers = (rows[headerRow] ?? []).slice(0, MAX_SHAPE_COLUMNS).map(h => String(h ?? "").trim());
  if (headers.some(h => h && headerLooksLikeValue(h))) return { problem: "titles" };
  const shapes = nonEmptyRows(rows.slice(headerRow + 1))
    .slice(0, MAX_SHAPE_ROWS)
    .map(r => headers.map((_, i) => cellShape(r?.[i])));
  if (shapes.length === 0) return { problem: "data" };
  return { input: { headers, headerShapes: headers.map(cellShape), shapes } };
}

/** Server side: the same input, re-validated strictly. Anything that isn't a
 *  header label or a shape is refused — never trimmed into one — and so is a
 *  header row that the browser's header-row check would refuse. */
export function parseShapeInput(input: unknown): { input: ShapeInput } | { error: string } {
  const o = input as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "body must be an object" };
  const { headers, headerShapes, shapes } = o as { headers?: unknown; headerShapes?: unknown; shapes?: unknown };
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > MAX_SHAPE_COLUMNS) return { error: "headers must be a list of 1 to 30" };
  if (headers.some(h => typeof h !== "string" || (h !== "" && headerLooksLikeValue(h)))) return { error: "headers must be column titles, not values" };
  const titles = headers as string[];
  if (!Array.isArray(headerShapes) || headerShapes.length !== titles.length || headerShapes.some((s, i) => s !== cellShape(titles[i]))) {
    return { error: "headerShapes must be the headers' own formats" };
  }
  if (!Array.isArray(shapes) || shapes.length === 0 || shapes.length > MAX_SHAPE_ROWS) return { error: "shapes must be a list of 1 to 10 rows" };
  for (const row of shapes) {
    if (!Array.isArray(row) || row.length !== titles.length || !row.every(isShape)) return { error: "shapes must be cell formats, one per header" };
  }
  const problem = headerRowProblem(titles, headerShapes as string[], shapes as string[][]);
  if (problem === "empty") return { error: "headers are all empty" };
  if (problem) return { error: "the header row is a data row, not column titles" };
  return { input: { headers: titles, headerShapes: headerShapes as string[], shapes: shapes as string[][] } };
}
