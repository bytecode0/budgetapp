// Statement import pipeline (Phase G).
//
// Turns an uploaded .xlsx/.csv buffer into normalized rows ready for preview:
//   - reads the sheet into a raw grid
//   - maps BBVA columns -> transactions
//   - derives a deterministic externalId (idempotency; reimport ≠ duplicate)
//   - flags rows already present (by externalId, in Expense or Income)
//   - splits debits -> expenses (with a suggested category) and credits -> income
import * as XLSX from "xlsx";
import crypto from "crypto";
import { prisma } from "./prisma.js";
import { normalizeMerchant } from "./normalizeMerchant.js";
import { categorize } from "./categorize.js";
import { gridToTransactions, type ParsedTxn } from "./parsers/bbva.js";

export type ImportKind = "expense" | "income";

export interface ImportRow {
  externalId: string;
  date: string;          // ISO day (yyyy-mm-dd)
  description: string;
  merchant: string;
  amount: number;        // euros, absolute
  signedAmount: number;  // euros, signed (for display)
  kind: ImportKind;
  status: "new" | "duplicate";
  suggestedAllocationId: string | null;
  suggestedAllocationName: string | null;
}

export interface ImportPreview {
  rows: ImportRow[];
  newCount: number;
  duplicateCount: number;
  expenseCount: number;
  incomeCount: number;
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Deterministic idempotency key. BBVA exports carry no stable transaction id, so
// we hash the stable fields; the running balance disambiguates same-day, same-
// amount, same-merchant charges that are genuinely distinct.
function externalIdFor(t: ParsedTxn, merchant: string): string {
  const key = [isoDay(t.date), Math.round(t.amount * 100), merchant, t.balance ?? ""].join("|");
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
}

function readGrid(buffer: Buffer, filename: string): unknown[][] {
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = buffer.toString("utf8");
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    const sep = (firstLine.split(";").length - 1) >= (firstLine.split(",").length - 1) ? ";" : ",";
    return text.split(/\r?\n/).map(line =>
      line.split(sep).map(c => c.replace(/^"(.*)"$/, "$1").trim())
    );
  }
  const wb = XLSX.read(buffer, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][];
}

export async function prepareImport(userId: string, buffer: Buffer, filename: string): Promise<ImportPreview> {
  const grid = readGrid(buffer, filename);
  const txns = gridToTransactions(grid);

  const prepared = txns
    .filter(t => t.amount !== 0)
    .map(t => {
      const merchant = normalizeMerchant(t.concept);
      return {
        t,
        merchant,
        externalId: externalIdFor(t, merchant),
        kind: (t.amount < 0 ? "expense" : "income") as ImportKind,
      };
    });

  // Which externalIds already exist (in either table) for this user?
  const ids = prepared.map(p => p.externalId);
  const [existExp, existInc] = await Promise.all([
    prisma.expense.findMany({ where: { userId, externalId: { in: ids } }, select: { externalId: true } }),
    prisma.income.findMany({ where: { userId, externalId: { in: ids } }, select: { externalId: true } }),
  ]);
  const seen = new Set<string>([...existExp, ...existInc].map(e => e.externalId!));

  // Suggested category for the (new) expense rows, via the Phase B rules.
  const rows: ImportRow[] = [];
  for (const p of prepared) {
    const isNew = !seen.has(p.externalId);
    let suggestedAllocationId: string | null = null;
    if (p.kind === "expense" && isNew) {
      suggestedAllocationId = await categorize(userId, p.t.concept, p.merchant);
    }
    rows.push({
      externalId: p.externalId,
      date: isoDay(p.t.date),
      description: p.t.concept,
      merchant: p.merchant,
      amount: Math.abs(p.t.amount),
      signedAmount: p.t.amount,
      kind: p.kind,
      status: isNew ? "new" : "duplicate",
      suggestedAllocationId,
      suggestedAllocationName: null, // filled in by the route (needs allocation names)
    });
  }

  return {
    rows,
    newCount: rows.filter(r => r.status === "new").length,
    duplicateCount: rows.filter(r => r.status === "duplicate").length,
    expenseCount: rows.filter(r => r.kind === "expense").length,
    incomeCount: rows.filter(r => r.kind === "income").length,
  };
}
