// Statement bytes → NormalizedRow[]. The single entry point for every file
// format. Pure (Uint8Array in, plain objects out, no Node-only API): stage 2
// runs it in the browser and posts only the rows (decision O).
//
// Format by content first (an .csv that is really Norma 43 is read as Norma 43),
// the file name only as a hint. For tabular files (CSV, XLSX), the columns
// come from, in order: the account's saved mapping, a bank profile, header
// synonyms. If none applies, StatementReadError("unrecognized_columns")
// carries the first rows so the mapping UI can show them.
import { applyMapping, detectMapping, findHeaderRow } from "./columns.js";
import { matchProfile } from "./profiles.js";
import { readCsv } from "./readers/csv.js";
import { looksLikeNorma43, readNorma43 } from "./readers/norma43.js";
import { looksLikeOfx, readOfx } from "./readers/ofx.js";
import { looksLikeWorkbook, readWorkbook, type Sheet } from "./readers/xlsx.js";
import { decodeText } from "./text.js";
import type { ColumnMapping, ReadResult } from "./types.js";

export type StatementErrorCode = "empty_file" | "unrecognized_columns" | "no_movements";

export class StatementReadError extends Error {
  constructor(
    readonly code: StatementErrorCode,
    message: string,
    /** For "unrecognized_columns": the first rows of each sheet, as text. */
    readonly sample?: { sheet: string; rows: string[][] }[],
  ) {
    super(message);
    this.name = "StatementReadError";
  }
}

export interface ReadOptions {
  /** The account's saved column mapping (Account.importProfile), if any. */
  mapping?: ColumnMapping | null;
}

function readGrid(sheet: Sheet, opts: ReadOptions): ReadResult | null {
  const { grid } = sheet;
  if (opts.mapping) {
    const headerRow = findHeaderRow(grid, opts.mapping);
    if (headerRow >= 0) {
      return { ...applyMapping(grid, headerRow, opts.mapping), source: "mapping", purchasesSign: opts.mapping.purchasesSign };
    }
  }
  const profile = matchProfile(grid);
  if (profile) return { ...applyMapping(grid, profile.headerRow, profile.profile.mapping), source: profile.profile.id };
  const detected = detectMapping(grid);
  if (detected) return { ...applyMapping(grid, detected.headerRow, detected.mapping), source: "generic" };
  return null;
}

/** Reads the sheets and keeps the one with the most movements. */
function readSheets(sheets: Sheet[], opts: ReadOptions): ReadResult {
  let best: ReadResult | null = null;
  for (const sheet of sheets) {
    const r = readGrid(sheet, opts);
    if (r && (!best || r.rows.length + r.skipped.length > best.rows.length + best.skipped.length)) best = r;
  }
  if (!best) {
    throw new StatementReadError(
      "unrecognized_columns",
      "No column with a date and an amount was recognised",
      sheets.map(s => ({ sheet: s.name, rows: s.grid.slice(0, 15).map(r => (r ?? []).map(c => String(c ?? ""))) })),
    );
  }
  if (best.rows.length === 0 && best.skipped.length === 0) {
    throw new StatementReadError("no_movements", "The file has the expected columns but no movements");
  }
  return best;
}

export function readStatement(bytes: Uint8Array, filename: string, opts: ReadOptions = {}): ReadResult {
  if (bytes.length === 0) throw new StatementReadError("empty_file", "The file is empty");
  if (looksLikeWorkbook(bytes)) return readSheets(readWorkbook(bytes), opts);

  const { text } = decodeText(bytes);
  if (looksLikeOfx(text)) {
    const { rows, skipped, source, currency } = readOfx(text);
    if (rows.length === 0) throw new StatementReadError("no_movements", "The OFX file has no movements");
    return { rows, skipped, source, currency };
  }
  if (looksLikeNorma43(text)) {
    const result = readNorma43(text);
    if (result.rows.length === 0) throw new StatementReadError("no_movements", "The Norma 43 file has no movements");
    return result;
  }
  return readSheets([{ name: filename, grid: readCsv(text) }], opts);
}
