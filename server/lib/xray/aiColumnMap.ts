// AI column mapping fallback for the Radiografía (R2).
//
// The BBVA parser recognizes BBVA (and close variants) by header name. When a
// statement from another bank doesn't match, we ask the AI to locate the header
// row and the date / concept / amount columns from a small sample of rows. The
// mapping is then applied to the WHOLE grid locally (parseAmount/parseDate), so
// the AI only ever sees a handful of rows — cheaper and more private. Degrades
// to null on any failure, exactly like the other AI helpers.
import { getAiClient, AI_MODEL, AI_TIMEOUT_MS } from "../ai/client.js";

export interface ColumnMapping {
  headerRow: number;
  dateCol: number;
  conceptCol: number;
  amountCol: number | null;   // single signed-amount column …
  debitCol: number | null;    // … or a debit (money out) + credit (money in) pair
  creditCol: number | null;
  balanceCol: number | null;
}

const PREVIEW_ROWS = 15;
const MAX_CELL = 60;

const SUBMIT_TOOL = {
  name: "submit_mapping",
  description: "Report the header row and column indices of a bank statement grid.",
  input_schema: {
    type: "object" as const,
    properties: {
      headerRow: { type: "integer", description: "0-based index of the header row" },
      dateCol: { type: "integer", description: "0-based column index of the transaction date" },
      conceptCol: { type: "integer", description: "0-based column index of the description/concept" },
      amountCol: { type: ["integer", "null"], description: "single signed-amount column, or null if debit/credit are separate" },
      debitCol: { type: ["integer", "null"], description: "debit (money out) column, or null" },
      creditCol: { type: ["integer", "null"], description: "credit (money in) column, or null" },
      balanceCol: { type: ["integer", "null"], description: "running-balance column, or null" },
    },
    required: ["headerRow", "dateCol", "conceptCol", "amountCol", "debitCol", "creditCol", "balanceCol"],
    additionalProperties: false,
  },
};

export async function mapColumnsWithAI(grid: unknown[][]): Promise<ColumnMapping | null> {
  const c = getAiClient();
  if (!c || grid.length === 0) return null;

  const maxCols = grid.reduce((m, r) => Math.max(m, (r ?? []).length), 0);
  const preview = grid.slice(0, PREVIEW_ROWS).map(row =>
    (row ?? []).map(cell => String(cell ?? "").slice(0, MAX_CELL)),
  );

  try {
    const res = await c.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 512,
        tools: [SUBMIT_TOOL],
        tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
        system:
          "You are given the first rows of a bank-statement export as a JSON array of rows (each row is an array of cell strings). " +
          "Locate the header row and the columns. Amounts may be a single signed column (e.g. 'Importe'), OR two separate columns for debit (money out) and credit (money in) — e.g. 'Cargo'/'Abono', 'Débito'/'Crédito', 'Salida'/'Entrada'. " +
          "Use 0-based indices. Set fields that don't exist to null. If there is a single amount column, set debitCol and creditCol to null (and vice-versa).",
        messages: [{ role: "user", content: JSON.stringify({ rows: preview }) }],
      },
      { timeout: AI_TIMEOUT_MS },
    );

    const toolUse = res.content.find(b => b.type === "tool_use");
    const raw = toolUse?.type === "tool_use" ? (toolUse.input as any) : null;
    if (!raw) return null;

    const idx = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v < maxCols ? v : null;

    const headerRow = typeof raw.headerRow === "number" && raw.headerRow >= 0 && raw.headerRow < grid.length ? raw.headerRow : null;
    const dateCol = idx(raw.dateCol);
    const conceptCol = idx(raw.conceptCol);
    const amountCol = idx(raw.amountCol);
    const debitCol = idx(raw.debitCol);
    const creditCol = idx(raw.creditCol);
    const balanceCol = idx(raw.balanceCol);

    // Need a header, a date, and a way to read the amount.
    if (headerRow === null || dateCol === null) return null;
    if (amountCol === null && debitCol === null && creditCol === null) return null;

    return { headerRow, dateCol, conceptCol: conceptCol ?? -1, amountCol, debitCol, creditCol, balanceCol };
  } catch (err) {
    console.error("[ai/mapColumns]", err);
    return null;
  }
}
