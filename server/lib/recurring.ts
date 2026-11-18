// Recurring-commitment detection (Phase F, feature #2; cadences LPBETA-12).
//
// Heuristic: a merchant is "recurring" when its charges come back at a steady
// rhythm with a stable amount. Amounts are compared in integer cents (Phase A)
// so there is no float drift; a tolerance band absorbs small variations (e.g.
// a subscription that nudges its price).
//
// The rhythm, over the charges close to the average (the band):
//   weekly   the median gap between the days they fall on is 5–10 days, with
//            at least 4 such charges;
//   monthly  across at least 3 distinct months (3 charges), and at most 2 a
//            month on average (two people in a household may pay the same
//            service on the same day);
//   yearly   the median gap is 300–430 days; 2 charges of (nearly) the same
//            amount are enough.
// A merchant bought from many times a month (a café, the supermarket) is NOT
// recurring: it is a frequent expense, never a fixed monthly commitment of one
// ticket's amount (before LPBETA-12 it was detected as one).
//
// A NEW charge (a free trial that turned paid): a merchant with exactly two
// charges of (nearly) the same amount, 20–45 days apart, the latest in the
// last 45 days, is monthly and flagged `isNew`.
//
// Price rise: the latest charge is higher than the one before, which repeated
// the price before it (or there is none before), at the merchant's rhythm and
// at most double — "Netflix ha pasado de 12,99 a 15,99". `previousAmount`
// holds the old price; with the next charge at the new price it is gone.
import { prisma } from "./prisma.js";

const MIN_MONTHS = 3;            // need history across at least 3 months
const MIN_IN_BAND = 3;           // at least 3 charges close to the average
const MIN_IN_BAND_WEEKLY = 4;    // a weekly rhythm needs a month of charges
const MAX_PER_MONTH = 2;         // more often than this is frequent spending, not a commitment
const BAND_RATIO = 0.2;          // ±20% of the average …
const BAND_FLOOR_CENTS = 300;    // … or ±3.00, whichever is larger
const DAY_MS = 86_400_000;

export type Cadence = "weekly" | "monthly" | "yearly";
/** Gap between charges, in days, for each rhythm (inclusive). Weekly and
 *  yearly detection use the median gap; monthly's window is for new charges
 *  and price rises. */
export const CADENCE_GAP_DAYS: Record<Cadence, readonly [number, number]> = {
  weekly: [5, 10],
  monthly: [20, 45],
  yearly: [300, 430],
};

export interface RecurringCandidate {
  merchant: string;
  avgAmount: number;             // cents
  cadence: Cadence;
  nextExpectedDate: Date;
  allocationId: string | null;   // most common allocation seen for this merchant
  lastAmount: number;            // cents, the latest charge
  lastDate: Date;
  previousAmount: number | null; // cents, the price before a rise in the latest charge
  isNew: boolean;                // two charges only, the latest recent (trial turned paid)
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

const daysBetween = (a: Date, b: Date) => Math.abs(b.getTime() - a.getTime()) / DAY_MS;
const inWindow = (days: number, cadence: Cadence) =>
  days >= CADENCE_GAP_DAYS[cadence][0] && days <= CADENCE_GAP_DAYS[cadence][1];

/** Same price give or take rounding: within 1 % or 0.50, whichever is larger. */
export function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(50, Math.round(Math.max(a, b) * 0.01));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function nextAfter(last: Date, cadence: Cadence): Date {
  if (cadence === "weekly") return new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7);
  if (cadence === "yearly") return new Date(last.getFullYear() + 1, last.getMonth(), last.getDate());
  return new Date(last.getFullYear(), last.getMonth() + 1, last.getDate());
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
  minMonths?: number;            // distinct months a monthly merchant must span (default 3)
  minInBand?: number;            // charges close to the average required (default 3)
  now?: Date;                    // "today", for new charges (default: now)
}

/**
 * Pure recurring-merchant detector. No DB access — give it a flat list of
 * charges and it returns the merchants that look like fixed commitments
 * (weekly, monthly or yearly). The thresholds are overridable so short
 * windows (e.g. a 1–2 month statement) can relax them.
 */
export function detectRecurringFrom(items: RecurringInput[], opts: RecurringOptions = {}): RecurringCandidate[] {
  const minMonths = opts.minMonths ?? MIN_MONTHS;
  const minInBand = opts.minInBand ?? MIN_IN_BAND;
  const now = opts.now ?? new Date();

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
    if (group.length < 2) continue;
    const months = new Set(group.map(e => monthKey(e.date)));

    const avg = group.reduce((s, e) => s + e.amount, 0) / group.length;
    const band = Math.max(avg * BAND_RATIO, BAND_FLOOR_CENTS);
    const inBand = group.filter(e => Math.abs(e.amount - avg) <= band);
    if (inBand.length < 2) continue; // amount too volatile → not a fixed commitment

    // Gaps between the days charges fall on (two on one day are one beat).
    const days = [...new Set(inBand.map(e => e.date.getTime()))];
    const gap = days.length >= 2 ? median(days.slice(1).map((t, i) => (t - days[i]) / DAY_MS)) : 0;
    const perMonth = inBand.length / new Set(inBand.map(e => monthKey(e.date))).size;
    const last = group[group.length - 1];
    let cadence: Cadence | null = null;
    let isNew = false;
    if (inWindow(gap, "weekly") && inBand.length >= Math.max(minInBand, MIN_IN_BAND_WEEKLY)) cadence = "weekly";
    else if (months.size >= minMonths && inBand.length >= minInBand && perMonth <= MAX_PER_MONTH) cadence = "monthly";
    else if (inWindow(gap, "yearly") && (inBand.length >= 3 || nearlyEqual(inBand[0].amount, inBand[1].amount))) cadence = "yearly";
    else if (group.length === 2 && inWindow(gap, "monthly") && nearlyEqual(group[0].amount, group[1].amount)
      && daysBetween(last.date, now) <= CADENCE_GAP_DAYS.monthly[1]) {
      cadence = "monthly";
      isNew = true;
    }
    if (!cadence) continue;

    const avgAmount = Math.round(inBand.reduce((s, e) => s + e.amount, 0) / inBand.length);
    const prev = group[group.length - 2];
    const beforePrev = group.length >= 3 ? group[group.length - 3] : null;
    const rose = last.amount > prev.amount && last.amount <= prev.amount * 2
      && (!beforePrev || beforePrev.amount === prev.amount)
      && inWindow(daysBetween(prev.date, last.date), cadence);

    candidates.push({
      merchant,
      avgAmount,
      cadence,
      nextExpectedDate: nextAfter(last.date, cadence),
      allocationId: mostCommon(group.map(e => e.allocationId ?? null)),
      lastAmount: last.amount,
      lastDate: last.date,
      previousAmount: rose ? prev.amount : null,
      isNew,
    });
  }

  return candidates;
}

/** Scan a user's expense history and return the merchants that look recurring.
 *  `only` narrows the movements read (e.g. to those one person can see). */
export async function detectRecurring(userId: string, only: object = {}): Promise<RecurringCandidate[]> {
  const expenses = await prisma.expense.findMany({
    where: { ...only, userId, merchant: { not: "" }, kind: "expense" }, // a refund isn't a charge
    select: { merchant: true, amount: true, date: true, allocationId: true },
    orderBy: { date: "asc" },
  });

  return detectRecurringFrom(expenses);
}
