// BBVA statement parser (Phase G).
//
// BBVA's .xlsx export has a few metadata rows (holder, IBAN, date range) before
// the actual table, and Spanish column headers. Rather than hard-coding row/col
// positions (which drift between exports), we detect the header row by matching
// known header synonyms, then map columns by name. New banks get their own
// parser file following the same shape.

export interface ParsedTxn {
  date: Date;
  concept: string;
  amount: number;        // euros, signed (negative = charge/expense, positive = credit)
  balance: number | null;
  // Text from the OTHER detail columns (BBVA ships three: Concepto / Movimiento /
  // Observaciones). `concept` stays the primary label so merchant names keep
  // reading cleanly; `extra` carries the rest for keyword classification, which
  // is where the meaning usually lives — BBVA puts a generic label in Concepto
  // ("Transferencia realizada", "Bizum") and the user's own reference text in
  // Movimiento ("Diezmo - Luis Vespa", "Saving", "Alquiler los valles").
  extra?: string;
}

const DATE_HEADERS = ["fecha", "fecha valor", "fecha operacion", "fecha contable", "f valor"];
const CONCEPT_HEADERS = ["concepto", "descripcion", "movimiento", "observaciones", "mas datos", "detalle"];
const AMOUNT_HEADERS = ["importe", "cantidad", "monto"];
const BALANCE_HEADERS = ["disponible", "saldo"]; // BBVA labels the running balance "Disponible"

function norm(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[()€.]/g, " ").replace(/\s+/g, " ").trim();
}

function matches(cell: string, headers: string[]): boolean {
  return headers.some(h => cell === h || cell.startsWith(h + " ") || cell === h.replace(/ /g, ""));
}

/** Parse a Spanish-formatted amount ("1.234,56", "-12,99", "12,99-") to a number. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let s = String(raw ?? "").replace(/[\s€]/g, "");
  if (!s) return null;
  let sign = 1;
  if (s.startsWith("-") || s.endsWith("-") || /^\(.*\)$/.test(s)) sign = -1;
  s = s.replace(/[()-]/g, "");
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? sign * n : null;
}

/** Parse a cell into a Date: native Date (cellDates), or "dd/mm/yyyy" / "yyyy-mm-dd". */
export function parseDate(raw: unknown): Date | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(year, Number(mo) - 1, Number(d));
    return isNaN(dt.getTime()) ? null : dt;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

interface ColumnMap { date: number; concepts: number[]; amount: number; balance: number; }

function findHeader(grid: unknown[][]): { rowIdx: number; cols: ColumnMap } | null {
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const row = grid[r] ?? [];
    const cells = row.map(norm);
    // Prefer the exact "Fecha" (operation date) over "F.Valor" when both exist.
    let date = cells.findIndex(c => c === "fecha");
    if (date === -1) date = cells.findIndex(c => matches(c, DATE_HEADERS));
    const amount = cells.findIndex(c => matches(c, AMOUNT_HEADERS));
    if (date === -1 || amount === -1) continue;
    return {
      rowIdx: r,
      cols: {
        date,
        amount,
        // ALL detail columns, not just the first: taking only the first one threw
        // away the column that actually identifies the movement.
        concepts: cells.flatMap((c, i) => (matches(c, CONCEPT_HEADERS) ? [i] : [])),
        balance: cells.findIndex(c => matches(c, BALANCE_HEADERS)),
      },
    };
  }
  return null;
}

/** Map a raw grid (rows of cells) into BBVA transactions. Throws if no header found. */
export function gridToTransactions(grid: unknown[][]): ParsedTxn[] {
  const header = findHeader(grid);
  if (!header) throw new Error("No recognizable BBVA header row (expected 'Fecha' and 'Importe')");

  const { rowIdx, cols } = header;
  const out: ParsedTxn[] = [];
  for (let r = rowIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = parseDate(row[cols.date]);
    const amount = parseAmount(row[cols.amount]);
    if (!date || amount === null) continue; // skip blanks / totals / footer rows

    // Collect every detail cell, de-duplicated case-insensitively: banks often
    // repeat the same text across columns (Observaciones is usually the uppercased
    // Movimiento), and a merchant name repeated twice mangles the merchant key.
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const ci of cols.concepts) {
      const v = String(row[ci] ?? "").trim();
      if (!v) continue;
      const fingerprint = v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      parts.push(v);
    }

    out.push({
      date,
      amount,
      concept: parts[0] ?? "",
      extra: parts.slice(1).join(" ") || undefined,
      balance: cols.balance >= 0 ? parseAmount(row[cols.balance]) : null,
    });
  }
  return out;
}
