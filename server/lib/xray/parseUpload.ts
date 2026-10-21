// Shared statement-upload parsing — used by both the live /api/xray/analyze
// (full flow, persists an XRaySession) and the new onboarding's extracto
// step (/api/radiografia/profile/extracto, no session, aggregates only).
// Moved out of routes/xray.ts so neither copy drifts from the other.
import { readGrid, externalIdFor } from "../importStatement.js";
import { gridToTransactions } from "../parsers/bbva.js";
import { mapColumnsWithAI } from "./aiColumnMap.js";
import { mapColumnsHeuristically, validateMapping } from "./heuristicColumnMap.js";
import { gridToTransactionsGeneric } from "./genericParser.js";
import { normalizeMerchant } from "../normalizeMerchant.js";
import { aiEnabled } from "../ai/client.js";
import type { TaggedTxn } from "./analyze.js";

export interface FileInput { filename: string; dataBase64: string }

// Parse one uploaded file into tagged transactions. Chain: deterministic BBVA
// parser → deterministic heuristic column mapping → AI column mapping as a
// last resort (only spent on statements the first two can't place). The AI
// mapping is re-validated with the SAME check the heuristic already applies
// to itself (validateMapping) — a mapping that guesses the balance column for
// the amount column produces a financial diagnosis built on garbage,
// regardless of which path produced the guess. Never throws.
export async function parseFile(f: FileInput, fileIndex: number): Promise<{ txns: TaggedTxn[]; bank: string }> {
  let grid: unknown[][];
  try { grid = readGrid(Buffer.from(f.dataBase64, "base64"), f.filename); }
  catch { return { txns: [], bank: "unreadable" }; }
  try {
    const txns = gridToTransactions(grid).filter(t => t.amount !== 0);
    return { txns: txns.map(t => ({ ...t, fileIndex })), bank: "bbva" };
  } catch {
    const heuristic = mapColumnsHeuristically(grid);
    if (heuristic) {
      const txns = gridToTransactionsGeneric(grid, heuristic).filter(t => t.amount !== 0);
      return { txns: txns.map(t => ({ ...t, fileIndex })), bank: "generic" };
    }

    const aiMapping = aiEnabled() ? await mapColumnsWithAI(grid) : null;
    if (aiMapping && validateMapping(grid, aiMapping)) {
      const txns = gridToTransactionsGeneric(grid, aiMapping).filter(t => t.amount !== 0);
      return { txns: txns.map(t => ({ ...t, fileIndex })), bank: "generic" };
    }
    return { txns: [], bank: "unrecognized" };
  }
}

// Drop exact duplicate rows (same file uploaded twice, or overlapping ranges).
export function dedupeTxns(txns: TaggedTxn[]): TaggedTxn[] {
  const seen = new Set<string>();
  const out: TaggedTxn[] = [];
  for (const t of txns) {
    const id = externalIdFor(t, normalizeMerchant(t.concept));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  return out;
}

// Accept either { filename, dataBase64 } (back-compat) or { files: [...] }.
export function filesFromBody(body: unknown): FileInput[] | null {
  const b = body as Record<string, unknown> | null | undefined;
  if (Array.isArray(b?.files)) {
    const fs = b.files.filter((f: unknown): f is FileInput => {
      const rec = f as Record<string, unknown>;
      return typeof rec?.filename === "string" && typeof rec?.dataBase64 === "string" && !!rec.dataBase64;
    });
    return fs.length ? fs : null;
  }
  if (typeof b?.filename === "string" && typeof b?.dataBase64 === "string" && b.dataBase64) {
    return [{ filename: b.filename as string, dataBase64: b.dataBase64 as string }];
  }
  return null;
}
