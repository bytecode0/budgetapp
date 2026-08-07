// Client-side mirror of server/lib/period.ts — see that file for the full
// rationale. Kept in sync by hand (no shared package between client/server in
// this repo, matching the existing pattern for merchant/money helpers).
//
// The frontend never needs periodKeyFor/periodBounds (it only ever navigates
// and displays labels; the backend derives actual date ranges from the real
// data), so only the label-arithmetic + display helpers live here.

export const MIN_CYCLE_START_DAY = 1;
export const MAX_CYCLE_START_DAY = 28;

export function clampCycleStartDay(day: number): number {
  if (!Number.isFinite(day)) return 1;
  return Math.min(MAX_CYCLE_START_DAY, Math.max(MIN_CYCLE_START_DAY, Math.round(day)));
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number) => `${y}-${pad(m0 + 1)}`;

/** The "YYYY-MM" period label containing `date`, per the user's cycleStartDay.
 *  Mirrors server/lib/period.ts periodKeyFor exactly — used client-side only
 *  to compute "today's period" for the month selector. */
export function periodKeyFor(date: Date, cycleStartDay: number): string {
  const day = clampCycleStartDay(cycleStartDay);
  let anchorYear = date.getFullYear();
  let anchorMonth = date.getMonth();
  if (date.getDate() < day) anchorMonth -= 1;

  const periodEnd = new Date(anchorYear, anchorMonth + 1, day);
  const lastDay = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate() - 1);
  return keyOf(lastDay.getFullYear(), lastDay.getMonth());
}

export function currentPeriodKey(cycleStartDay: number): string {
  return periodKeyFor(new Date(), cycleStartDay);
}

/** Next/previous period label — pure label arithmetic, independent of cycleStartDay. */
export function periodKeyOffset(base: string, offset: number): string {
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return keyOf(d.getFullYear(), d.getMonth());
}

/** Display label for a period key, e.g. "August 2026". */
export function periodLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** Display sub-label for the actual date range a period covers, e.g.
 *  "Jul 25 - Aug 24" — only meaningful when cycleStartDay !== 1; callers
 *  should hide this for calendar-month users to avoid redundant noise. */
export function periodRangeLabel(key: string, cycleStartDay: number, locale: string): string {
  const day = clampCycleStartDay(cycleStartDay);
  const [y, m] = key.split('-').map(Number);
  const end = new Date(y, m - 1, day === 1 ? 1 : day);
  const start = day === 1 ? new Date(y, m - 2, 1) : new Date(y, m - 2, day);
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
  const fmt = (d: Date) => d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  return `${fmt(start)} - ${fmt(lastDay)}`;
}
