// Shared shapes of the ingest pipeline (docs/plan-deudas-y-onboarding.md §4.1).
//
//   bytes ──readers/──▶ grid | rows ──columns/profiles──▶ NormalizedRow[]
//         ──classify──▶ PlannedRow[] (decision + dedup) ──importStatement──▶ preview / DB
//
// Everything up to NormalizedRow lives in shared/ingest/: pure TypeScript with
// no Node-only API, run by the browser (the import wizard reads the file and
// posts only rows, decision O) and by the server (fallback file path). What
// needs the database or Node (classify, writes) stays in server/lib/ingest/. Money is
// integer cents from the first step; dates are calendar days ("yyyy-mm-dd"),
// never Date objects, so no timezone can move a movement to another day.

/** One movement as read from a statement, before any decision is taken. */
export interface NormalizedRow {
  /** Position in the source (0-based, file order). Breaks ties; shown in errors. */
  rowIndex: number;
  /** Calendar day of the operation, "yyyy-mm-dd". */
  date: string;
  /** Signed cents from the HOLDER's point of view: negative = money out of the
   *  account / more owed on the card; positive = money in / less owed. */
  amountCents: number;
  /** Primary label (merchant names read cleanly from it). */
  description: string;
  /** Other detail columns joined (BBVA's Movimiento/Observaciones…), for search
   *  and classification; never part of the merchant key. */
  details?: string;
  /** Running balance after the movement, when the file has one (cents). */
  balanceCents?: number | null;
  /** The source's own id for the movement (OFX FITID…), when it has one. */
  externalRef?: string | null;
  /** ISO 4217 code, when the file says it. */
  currency?: string | null;
  /** The source's state ("COMPLETED"…) for files that list unsettled rows. */
  state?: string | null;
  /** A fee charged on top of the movement, signed like amountCents (≤ 0). */
  feeCents?: number | null;
}

/** A row the reader saw but deliberately left out (pending, declined…). */
export interface SkippedRow {
  rowIndex: number;
  reason: string; // machine code: "state:PENDING", "no_date", "no_amount"…
}

export type DateOrder = "dmy" | "mdy" | "ymd";

/**
 * How to read a grid's columns. Columns are named by their HEADER TEXT (as
 * shown in the file), so a saved mapping survives a bank reordering columns.
 * It's what bank profiles produce and what the user saves per account when a
 * file isn't recognised (Account.importProfile).
 */
export interface ColumnMapping {
  date: string;
  /** One signed amount column… */
  amount?: string;
  /** …or separate money-out / money-in columns. */
  debit?: string;
  credit?: string;
  /** One or more detail columns; the first non-empty is the description. */
  description: string[];
  balance?: string;
  currency?: string;
  state?: string;
  fee?: string;
  /** Order of day/month/year in text dates. Default "dmy" (Spanish). */
  dateOrder?: DateOrder;
  /** Decimal separator, when the file is ambiguous. Default: detected. */
  decimal?: "," | ".";
  /** Card statements only: how purchases appear in the file. "positive"
   *  flips every amount to the holder's view. Default: detected (see classify). */
  purchasesSign?: "negative" | "positive";
}

export type StatementSource = "bbva" | "revolut" | "generic" | "mapping" | "norma43" | "ofx" | "rows";

export interface ReadResult {
  rows: NormalizedRow[];
  skipped: SkippedRow[];
  /** Which reader/profile understood the file. */
  source: StatementSource;
  /** Card sign convention stated by the mapping, when there is one. */
  purchasesSign?: "negative" | "positive";
  /** Currency the file declares for the whole statement (OFX, Norma 43). */
  currency?: string | null;
  /** Tabular files: the mapping that read it (saved, bank profile or header
   *  synonyms). The wizard saves it with the user's card sign choice. */
  mapping?: ColumnMapping;
}
