// Recurring-commitment detection (Phase F, feature #2).
//
// Heuristic: a merchant is "recurring" when it appears across at least
// MIN_MONTHS distinct months with a stable amount. Amounts are compared in
// integer cents (Phase A) so there is no float drift; a tolerance band absorbs
// small variations (e.g. a subscription that nudges its price).
import { prisma } from "./prisma.js";

const MIN_MONTHS = 3;            // need history across at least 3 months
const MIN_IN_BAND = 3;           // at least 3 charges close to the average
const BAND_RATIO = 0.2;          // ±20% of the average …
const BAND_FLOOR_CENTS = 300;    // … or ±3.00, whichever is larger

export interface RecurringCandidate {
  merchant: string;
  avgAmount: number;             // cents
  cadence: "monthly";
  nextExpectedDate: Date;
  allocationId: string | null;   // most common allocation seen for this merchant
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

// A single charge, in the shape the pure detector needs. Amounts are integer
// cents (Phase A). Decoupled from Prisma so the same heuristic can run over an
// user's history or over a freshly parsed statement.
export interface RecurringInput {
  merchant: string;
  amount: number;                // cents (positive magnitude)
  date: Date;
  allocationId?: string | null;
}

export interface RecurringOptions {
  minMonths?: number;            // distinct months a merchant must span (default 3)
  minInBand?: number;            // charges close to the average required (default 3)
}

/**
 * Pure recurring-merchant detector. No DB access — give it a flat list of
 * charges and it returns the merchants that look like fixed monthly commitments.
 * The thresholds are overridable so short windows (e.g. a 1–2 month statement)
 * can relax them.
 */
export function detectRecurringFrom(items: RecurringInput[], opts: RecurringOptions = {}): RecurringCandidate[] {
  const minMonths = opts.minMonths ?? MIN_MONTHS;
  const minInBand = opts.minInBand ?? MIN_IN_BAND;

  const byMerchant = new Map<string, RecurringInput[]>();
  for (const e of items) {
    if (!e.merchant) continue;
    const arr = byMerchant.get(e.merchant) ?? [];
    arr.push(e);
    byMerchant.set(e.merchant, arr);
  }

  const candidates: RecurringCandidate[] = [];
  for (const [merchant, group] of byMerchant) {
    group.sort((a, b) => a.date.getTime() - b.date.getTime());
    const months = new Set(group.map(e => monthKey(e.date)));
    if (months.size < minMonths) continue;

    const amounts = group.map(e => e.amount);
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    const band = Math.max(avg * BAND_RATIO, BAND_FLOOR_CENTS);
    const inBand = amounts.filter(a => Math.abs(a - avg) <= band);
    if (inBand.length < minInBand) continue; // amount too volatile → not a fixed commitment

    const avgAmount = Math.round(inBand.reduce((s, a) => s + a, 0) / inBand.length);
    const lastDate = group[group.length - 1].date;
    const nextExpectedDate = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, lastDate.getDate());

    candidates.push({
      merchant,
      avgAmount,
      cadence: "monthly",
      nextExpectedDate,
      allocationId: mostCommon(group.map(e => e.allocationId ?? null)),
    });
  }

  return candidates;
}

/** Scan a user's expense history and return the merchants that look recurring. */
export async function detectRecurring(userId: string): Promise<RecurringCandidate[]> {
  const expenses = await prisma.expense.findMany({
    where: { userId, merchant: { not: "" }, kind: "expense" }, // a refund isn't a charge
    select: { merchant: true, amount: true, date: true, allocationId: true },
    orderBy: { date: "asc" },
  });

  return detectRecurringFrom(expenses);
}
