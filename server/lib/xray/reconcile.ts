// Internal-transfer reconciliation for the Radiografía (multi-account, R6+).
//
// When the user uploads more than one account, a transfer OUT of one account
// that matches a transfer IN to another is an INTERNAL movement of their own
// money — it must not count as spending, income or a savings-outflow, and must
// not be double-counted. We greedily pair each transfer-like outflow with the
// best unmatched transfer-like inflow in a DIFFERENT file, within a small
// amount tolerance and date window. Single-account uploads are a no-op.
import { isTransferLike } from "./wealth.js";
import { describeMovement } from "./transferDetail.js";
import type { MovementType, MovementKind } from "./wealth.js";

export interface ReconInput {
  kind: "expense" | "income";
  cents: number;          // positive magnitude
  date: Date;
  fileIndex: number;
  concept: string;
  movementType: MovementType;
  movementKind: MovementKind;
}

export interface ReconResult {
  internal: Set<number>;                 // indices of reconciled rows (both sides)
  count: number;                         // number of matched PAIRS
  totalCents: number;                    // sum of matched outflow magnitudes
  items: { detail: string | null; total: number; count: number }[]; // grouped for display (euros)
}

const TOLERANCE_CENTS = 0;               // bank transfers move exact amounts
const DATE_WINDOW_DAYS = 4;              // out and in can post a few days apart
const DAY_MS = 86_400_000;

const empty = (): ReconResult => ({ internal: new Set(), count: 0, totalCents: 0, items: [] });

export function reconcile(rows: ReconInput[]): ReconResult {
  if (new Set(rows.map(r => r.fileIndex)).size < 2) return empty();

  // Eligible outflows: transfer-like or wealth (savings/investment), never a real
  // purchase and never cash. Eligible inflows: transfer-like credits (not salary).
  const outflows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind === "expense" && r.movementType !== "consumption" && r.movementKind !== "cash")
    .sort((a, b) => a.r.date.getTime() - b.r.date.getTime());
  const inflows = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind === "income" && isTransferLike(r.concept));

  const internal = new Set<number>();
  const usedInflow = new Set<number>();
  const grouped = new Map<string, { detail: string | null; cents: number; count: number }>();
  let count = 0;
  let totalCents = 0;

  for (const out of outflows) {
    let best: { idx: number; dayDelta: number; centDelta: number } | null = null;
    for (const inn of inflows) {
      if (usedInflow.has(inn.i)) continue;
      if (inn.r.fileIndex === out.r.fileIndex) continue;
      const centDelta = Math.abs(out.r.cents - inn.r.cents);
      if (centDelta > TOLERANCE_CENTS) continue;
      const dayDelta = Math.abs(out.r.date.getTime() - inn.r.date.getTime()) / DAY_MS;
      if (dayDelta > DATE_WINDOW_DAYS) continue;
      if (!best || dayDelta < best.dayDelta || (dayDelta === best.dayDelta && centDelta < best.centDelta)) {
        best = { idx: inn.i, dayDelta, centDelta };
      }
    }
    if (!best) continue;

    internal.add(out.i);
    internal.add(best.idx);
    usedInflow.add(best.idx);
    count += 1;
    totalCents += out.r.cents;

    const { detail, movementKey } = describeMovement(out.r.concept, "transfer");
    const g = grouped.get(movementKey) ?? { detail, cents: 0, count: 0 };
    g.cents += out.r.cents;
    g.count += 1;
    grouped.set(movementKey, g);
  }

  const items = [...grouped.values()]
    .map(g => ({ detail: g.detail, total: Math.round(g.cents) / 100, count: g.count }))
    .sort((a, b) => b.total - a.total);

  return { internal, count, totalCents, items };
}
