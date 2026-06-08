// Money handling — single source of truth for the cents boundary.
//
// All monetary values are stored as INTEGER cents in the database and used as
// cents throughout backend logic (exact equality for dedup, exact budget
// thresholds, no floating-point drift). The HTTP API, however, still speaks
// euros as decimal numbers, so the frontend is unchanged.
//
// Rule of thumb:
//   - Reading from the request body (euros)  -> toCents() before writing/comparing
//   - Building a JSON response               -> serializeMoney() to emit euros

/** Euros (number or numeric string) -> integer cents. Invalid input -> 0. */
export function toCents(euros: number | string | null | undefined): number {
  if (euros === null || euros === undefined || euros === "") return 0;
  const n = typeof euros === "string" ? parseFloat(euros) : euros;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Integer cents -> euros as a number (exact to 2 decimals). */
export function toEuros(cents: number | null | undefined): number {
  if (cents === null || cents === undefined) return 0;
  return cents / 100;
}

// Keys that hold monetary values anywhere in an API response. Any property with
// one of these names is converted from cents to euros by serializeMoney().
const MONEY_KEYS = new Set([
  "amount",
  "allocatedAmount",
  "actualAmount",
  "targetAmount",
  "currentAmount",
  "monthlyContribution",
  "monthlyIncome",
  "expectedAmount",
  "depositedAmount",
  "budgeted",
  "actual",
  "diff",
  "totalBudgeted",
  "totalActual",
  "unassigned",
  "total",
  "avg",
  "deposited",
  "cumulative",
]);

/**
 * Deep-clones a response payload converting every MONEY_KEYS property from
 * integer cents to euros. Walks arrays and nested objects (e.g. an expense with
 * an included allocation). Dates and other non-plain values are left untouched.
 * Apply exactly once, at the response edge.
 */
export function serializeMoney<T>(payload: T): T {
  return convert(payload) as T;
}

function convert(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(convert);
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = MONEY_KEYS.has(key) && typeof val === "number" ? toEuros(val) : convert(val);
    }
    return out;
  }
  return value;
}
