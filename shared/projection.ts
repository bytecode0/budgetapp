// Growth simulator for investment and wealth plans (LPBETA-06). These are
// example rates to motivate saving, not a forecast or advice: the UI always
// shows the "simulation, not a promise" notice next to them.
//
// The only place the rates live. The labels and notes interpolate them.

/** Annual rates in percent: low · medium · high, the same for every compound plan. */
export const PROJECTION_RATE_PCTS = { low: 3.5, medium: 5, high: 7 } as const;

/** The same rates as fractions, in the order low, medium, high. */
export const PROJECTION_RATES: [number, number, number] = [
  PROJECTION_RATE_PCTS.low / 100,
  PROJECTION_RATE_PCTS.medium / 100,
  PROJECTION_RATE_PCTS.high / 100,
];

/** Balance after `months` of monthly contributions, compounded monthly. */
export function compoundBalance(current: number, monthly: number, months: number, annualRate: number): number {
  if (annualRate === 0) return current + monthly * months;
  const r = annualRate / 12;
  return current * Math.pow(1 + r, months) + monthly * (Math.pow(1 + r, months) - 1) / r;
}
