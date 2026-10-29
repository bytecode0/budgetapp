// Budget-period math, decoupled from the calendar month (Phase 0/1).
//
// A "period" is still labeled the same way a calendar month always was —
// a "YYYY-MM" string — but the actual date range it covers is anchored to the
// user's payday (`cycleStartDay`, 1-28) instead of always starting on the 1st.
//
// The period is always labeled by the calendar month of its LAST real day —
// i.e. the month the paycheck is funding. For cycleStartDay=1 this reduces
// exactly to today's calendar-month behavior (every existing user is
// unaffected until they set a payday). For cycleStartDay=25, the period
// Jul 25 -> Aug 25 (exclusive) is labeled "2026-08", matching a paycheck
// received Jun 25 that funds the "July-August" cycle.
//
// Crucially, the period is DERIVED from each transaction's real `date` at
// query time — nothing is stored on the transaction. Changing `cycleStartDay`
// (a payday change) or re-bucketing all of history is therefore free: every
// past and present period is simply recomputed, with no migration and no
// risk of losing or duplicating a row.
//
// All of it is in UTC: a movement's day is stored at midnight UTC (imports,
// and a "yyyy-mm-dd" from the client), so bounds built in the server's local
// time would put the 1st in the previous month on a server west of UTC.
// Production runs in UTC, where nothing changes.

export const MIN_CYCLE_START_DAY = 1;
export const MAX_CYCLE_START_DAY = 28; // avoid short-month gaps (Feb has only 28/29 days)

export function clampCycleStartDay(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(MAX_CYCLE_START_DAY, Math.max(MIN_CYCLE_START_DAY, Math.round(day)));
}

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m0: number) => `${y}-${pad(m0 + 1)}`; // m0 is 0-indexed
/** Midnight UTC of a day; out-of-range months/days roll over like Date's. */
const utcDay = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d));

/** The "YYYY-MM" period label containing `date`, per the user's cycleStartDay. */
export function periodKeyFor(date: Date, cycleStartDay: number): string {
  const day = clampCycleStartDay(cycleStartDay);
  const anchorYear = date.getUTCFullYear();
  let anchorMonth = date.getUTCMonth(); // 0-indexed
  if (date.getUTCDate() < day) anchorMonth -= 1; // Date.UTC normalizes month <0 into the prior year

  const periodEnd = utcDay(anchorYear, anchorMonth + 1, day);
  // The period's last real day is periodEnd - 1; its month is the period's label.
  const lastDay = utcDay(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate() - 1);
  return keyOf(lastDay.getUTCFullYear(), lastDay.getUTCMonth());
}

/** [start, end) Date bounds for a "YYYY-MM" period label. `end` is exclusive. */
export function periodBounds(periodKey: string, cycleStartDay: number): { start: Date; end: Date } {
  const day = clampCycleStartDay(cycleStartDay);
  const [y, m] = periodKey.split("-").map(Number); // m is 1-12
  if (day === 1) {
    // Calendar month — identical to today's behavior.
    return { start: utcDay(y, m - 1, 1), end: utcDay(y, m, 1) };
  }
  // The labeled period ends on cycleStartDay of its own labeled month, and
  // starts on cycleStartDay of the previous month.
  return { start: utcDay(y, m - 2, day), end: utcDay(y, m - 1, day) };
}

/** The period label containing "now". */
export function currentPeriodKey(cycleStartDay: number, now: Date = new Date()): string {
  return periodKeyFor(now, cycleStartDay);
}

/** The period label `offset` periods away from `base` ("YYYY-MM" arithmetic;
 *  independent of cycleStartDay since labels are always sequential months). */
export function periodKeyOffset(base: string, offset: number): string {
  const [y, m] = base.split("-").map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return keyOf(d.getFullYear(), d.getMonth());
}

/** Every period label from `fromKey` to `toKey`, inclusive, in order. */
export function enumeratePeriods(fromKey: string, toKey: string): string[] {
  const [fy, fm] = fromKey.split("-").map(Number);
  const [ty, tm] = toKey.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  // Guard against a bad range producing an unbounded loop.
  for (let i = 0; i < 1000 && (y < ty || (y === ty && m <= tm)); i++) {
    out.push(keyOf(y, m - 1));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}
