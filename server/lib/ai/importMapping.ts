// AI column mapping for statements no profile recognises (4.2). The model
// gets the header row's titles, as the user saw and confirmed them, and the
// FORMAT of the first cells (shared/ingest/shapes.ts: "dd/mm/yyyy", "-#,##",
// "TEXT(12)"…). Formats carry no value. Titles are checked here again, but
// only as far as a check can: a value-shaped title, a header row that reads
// like the data below it, ids, emails and name-like titles are refused. A
// title is still text from the file, so this is a best effort, not a
// guarantee that no personal data is sent. Its answer is a SUGGESTION: validated as a
// ColumnMapping naming only columns that exist, then pre-filled in the
// manual mapping screen, where the user confirms it.
import { columnIndex } from "../../../shared/ingest/columns.js";
import { parseShapeInput, type ShapeInput } from "../../../shared/ingest/shapes.js";
import { parseColumnMapping } from "../../../shared/ingest/validate.js";
import type { ColumnMapping } from "../../../shared/ingest/types.js";
import { aiAvailable, complete } from "./index.js";

const SYSTEM = [
  "You map the columns of a bank or credit-card statement export (Spanish or English) to a fixed schema.",
  "You receive the column titles and, for each column, the FORMAT of its first cells, never their values:",
  "dd/mm/yyyy, mm/dd/yyyy, nn/nn/yyyy (day and month can't be told apart), yyyy-mm-dd = dates;",
  "-#,## or #.###,## or #,###.## = amounts (a leading - is negative, CUR = a currency symbol or code);",
  "INT / DEC = numeric spreadsheet cells (INT can also be an Excel date); CODE3 = a 3-letter code such as a currency;",
  "TEXT(n) = text of n characters; EMPTY = blank.",
  "Answer with ONE JSON object and nothing else:",
  "{\"date\": title, \"amount\": title, \"debit\": title, \"credit\": title, \"description\": [titles], \"balance\": title,",
  "\"currency\": title, \"state\": title, \"fee\": title, \"dateOrder\": \"dmy\"|\"mdy\"|\"ymd\", \"decimal\": \",\"|\".\"}.",
  "Rules: every title must be copied EXACTLY from the given titles. date is required.",
  "Use amount when one signed column holds the money; otherwise debit (money out) and/or credit (money in), never both styles.",
  "description: the text columns that describe the movement, most informative first (max 5).",
  "Omit any optional key you are not sure about. dateOrder from the date formats (Spanish statements are usually dmy).",
  "decimal: the decimal separator of the amount column.",
].join(" ");

export type SuggestResult =
  | { mapping: ColumnMapping }
  | { error: "invalid_input"; message: string }
  | { error: "unavailable" }
  | { error: "rate_limited" }
  | { error: "no_suggestion" };

/** The JSON object in a model answer (some models wrap it in prose or fences). */
function extractJson(text: string): unknown {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

/** The model's mapping, kept only as far as it names real columns. */
export function checkSuggestion(raw: unknown, headers: string[]): ColumnMapping | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const exists = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && columnIndex(headers, v) >= 0;
  const o = raw as Record<string, unknown>;
  const pick = (k: string) => (exists(o[k]) ? { [k]: o[k] } : {});
  const candidate = {
    ...pick("date"), ...pick("amount"), ...pick("balance"), ...pick("currency"), ...pick("state"), ...pick("fee"),
    // One amount style: a signed column wins over split ones.
    ...(exists(o.amount) ? {} : { ...pick("debit"), ...pick("credit") }),
    description: Array.isArray(o.description) ? [...new Set(o.description.filter(exists))].slice(0, 5) : [],
    ...(["dmy", "mdy", "ymd"].includes(o.dateOrder as string) ? { dateOrder: o.dateOrder } : {}),
    ...(o.decimal === "," || o.decimal === "." ? { decimal: o.decimal } : {}),
    // purchasesSign is never taken from a model: the user decides it.
  };
  const parsed = parseColumnMapping(candidate);
  return "mapping" in parsed ? parsed.mapping : null;
}

/** The prompt: titles and formats only, column by column. */
export function buildPrompt(input: ShapeInput): string {
  return JSON.stringify({
    columns: input.headers.map((title, i) => ({ title, formats: [...new Set(input.shapes.map(r => r[i]))] })),
  });
}

/** Validates what the client sent (titles + formats only), then — if the
 *  feature is configured and `allow()` (the caller's rate limit) says so —
 *  asks the model. Throws only on a provider failure. */
export async function suggestImportMapping(body: unknown, allow: () => boolean = () => true): Promise<SuggestResult> {
  if (!aiAvailable("importMapping")) return { error: "unavailable" };
  const parsed = parseShapeInput(body);
  if ("error" in parsed) return { error: "invalid_input", message: parsed.error };
  if (!allow()) return { error: "rate_limited" };
  const text = await complete("importMapping", { system: SYSTEM, prompt: buildPrompt(parsed.input), json: true, maxTokens: 400 });
  const mapping = checkSuggestion(extractJson(text), parsed.input.headers);
  return mapping ? { mapping } : { error: "no_suggestion" };
}
