// Debt detail and payoff plan charts (LPBETA-02). Pure: the routes in
// server/routes/debts.ts load the rows and call these. Everything in cents;
// serializeMoney converts at the response edge.
//
// Rules:
//  1. Months. Simulated month k is calendar month (current month + k), the
//     same convention the Debts screen has always used for "debt-free by".
//     The current month is the last month of the real past.
//  2. What can be projected. A debt needs a monthly payment (minimumPayment,
//     else installmentAmount, > 0). A debt paid by its minimum also needs its
//     APR (TAE): without it the simulation would invent a date. An installment
//     plan doesn't: its cuotas already carry the interest, so a missing APR
//     counts as 0. A missing one is reported (`missing`), never guessed.
//  3. A debt in "full" payment mode (a card paid in full every month) isn't
//     debt to pay down over time: it's left out of every projection.
//  4. Cards: the projection assumes no new purchases (the UI says so).
//  5. The simulator is only for looking: nothing here writes anything.
import type { DebtLedger } from "./debtBalance.js";
import { debtState, owedNow } from "./debtBalance.js";
import {
  simulatePayoffSeries, PAYOFF_MAX_MONTHS,
  type PayoffDebtInput, type PayoffMethod, type PayoffOptions, type PayoffSeries,
} from "./debtPayoff.js";

// ── Months ────────────────────────────────────────────────────────────────

/** "YYYY-MM" of the UTC month `date` falls in. */
export const monthKeyOf = (date: Date) => date.toISOString().slice(0, 7);

/** `key` moved by `n` months. */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  return monthKeyOf(new Date(Date.UTC(y, m - 1 + n, 1)));
}

/** Whole months from `from` to `to` ("YYYY-MM" both). */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

const startOfMonth = (key: string) => new Date(`${key}-01T00:00:00.000Z`);

// ── Simulator inputs ──────────────────────────────────────────────────────

export const MAX_EXTRA_CENTS = 100_000_00;    // 100 000 a month
export const MAX_ONE_OFF_CENTS = 10_000_000_00; // 10 million once

export interface SimulatorInput {
  method: PayoffMethod;
  extraCents: number;
  oneOff: { month: number; amountCents: number } | null; // month in simulated months (≥ 1)
  oneOffMonth: string | null; // "YYYY-MM", echoed back
}

export type SimulatorInputError = { error: string; code: "invalid_amount" | "invalid_month" | "invalid_method" };

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function amountCents(raw: unknown, cap: number): number | null {
  if (raw === undefined || raw === "") return 0;
  if (typeof raw !== "string" || !AMOUNT.test(raw.trim())) return null;
  const cents = Math.round(parseFloat(raw.trim()) * 100);
  return cents <= cap ? cents : null;
}

/** Reads `method`, `extra`, `oneOff` and `oneOffMonth` from a query string
 *  (euros, "50" or "50.25"). Amounts are ≥ 0 and capped; a one-off needs a
 *  month from next month on, within the simulation's horizon. */
export function parseSimulatorQuery(query: Record<string, unknown>, now: Date): SimulatorInput | SimulatorInputError {
  const method = query.method ?? "snowball";
  if (method !== "snowball" && method !== "avalanche") return { error: "method must be snowball or avalanche", code: "invalid_method" };
  const extraCents = amountCents(query.extra, MAX_EXTRA_CENTS);
  if (extraCents === null) return { error: "extra must be an amount between 0 and 100000", code: "invalid_amount" };
  const oneOffCents = amountCents(query.oneOff, MAX_ONE_OFF_CENTS);
  if (oneOffCents === null) return { error: "oneOff must be an amount between 0 and 10000000", code: "invalid_amount" };
  if (oneOffCents === 0) return { method, extraCents, oneOff: null, oneOffMonth: null };

  const raw = query.oneOffMonth;
  if (typeof raw !== "string" || !MONTH.test(raw)) return { error: "oneOffMonth must be YYYY-MM", code: "invalid_month" };
  const month = monthsBetween(monthKeyOf(now), raw);
  if (month < 1 || month > PAYOFF_MAX_MONTHS) return { error: "oneOffMonth must be from next month on", code: "invalid_month" };
  return { method, extraCents, oneOff: { month, amountCents: oneOffCents }, oneOffMonth: raw };
}

// ── What can be projected ─────────────────────────────────────────────────

export interface ProjectableDebt {
  id: string;
  kind: string;
  paymentMode: string;
  apr: number | null;
  minimumPayment: number | null; // cents
  installmentAmount: number | null; // cents
}

export type MissingField = "apr" | "minimum";
export type Projectability =
  | { status: "ok"; input: PayoffDebtInput }
  | { status: "paid_in_full" }
  | { status: "nothing_owed" }
  | { status: "needs_data"; missing: MissingField[] };

/** Rules 2 and 3 for one debt owing `owedCents`. */
export function projectability(d: ProjectableDebt, owedCents: number): Projectability {
  if (d.paymentMode === "full") return { status: "paid_in_full" };
  if (owedCents <= 0) return { status: "nothing_owed" };
  const minimum = d.minimumPayment ?? d.installmentAmount;
  const missing: MissingField[] = [];
  if (d.paymentMode !== "installments" && d.apr == null) missing.push("apr");
  if (!minimum || minimum <= 0) missing.push("minimum");
  if (missing.length > 0) return { status: "needs_data", missing };
  return {
    status: "ok",
    input: { id: d.id, currentBalance: owedCents, apr: d.apr ?? 0, minimumPayment: minimum!, installmentAmount: null },
  };
}

// ── Scenario (one simulation, dated) ──────────────────────────────────────

export interface Scenario {
  months: number;
  converged: boolean;
  payoffMonth: string | null; // "YYYY-MM" when it converges
  totalInterestPaid: number;
  totalPaid: number;
}

export function scenarioOf(sim: PayoffSeries, startMonth: string): Scenario {
  return {
    months: sim.months,
    converged: sim.converged,
    payoffMonth: sim.converged ? addMonths(startMonth, sim.months) : null,
    totalInterestPaid: sim.totalInterestPaid,
    totalPaid: sim.totalPaid,
  };
}

const simOptions = (input: SimulatorInput): PayoffOptions => ({ extraPaymentCents: input.extraCents, oneOff: input.oneOff });

// ── Debt detail ───────────────────────────────────────────────────────────

export const PAST_MONTHS_CAP = 120;

/** The real balance at the end of each month, from the month the balance was
 *  anchored to the current month (which shows the live balance). Up to the
 *  last PAST_MONTHS_CAP months. From the ledger, never stored. */
export function pastBalances(ledger: DebtLedger, now: Date): { month: string; owed: number }[] {
  const current = monthKeyOf(now);
  const anchor = ledger.debt.balanceAsOf ? monthKeyOf(ledger.debt.balanceAsOf) : current;
  const first = monthsBetween(anchor, current) > PAST_MONTHS_CAP - 1 ? addMonths(current, -(PAST_MONTHS_CAP - 1)) : anchor;
  const out: { month: string; owed: number }[] = [];
  for (let key = first; monthsBetween(key, current) > 0; key = addMonths(key, 1)) {
    out.push({ month: key, owed: Math.max(0, debtState(ledger, startOfMonth(addMonths(key, 1))).balance) });
  }
  out.push({ month: current, owed: owedNow(ledger) });
  return out;
}

export interface DetailProjection {
  status: Projectability["status"];
  missing: MissingField[];
  base: (Scenario & { series: { month: string; owed: number }[] }) | null;      // minimum only
  simulated: (Scenario & { series: { month: string; owed: number }[] }) | null; // with extra / one-off
}

/** The projection of one debt: as it goes (its own payment) and with the
 *  simulator's extra and one-off. Each series starts at the current month. */
export function debtProjection(d: ProjectableDebt, ledger: DebtLedger, input: SimulatorInput, now: Date): DetailProjection {
  const owed = owedNow(ledger);
  const p = projectability(d, owed);
  if (p.status !== "ok") return { status: p.status, missing: p.status === "needs_data" ? p.missing : [], base: null, simulated: null };
  const start = monthKeyOf(now);
  const run = (options: PayoffOptions) => {
    const sim = simulatePayoffSeries([p.input], "avalanche", options);
    return {
      ...scenarioOf(sim, start),
      series: [{ month: start, owed }, ...sim.series.map(m => ({ month: addMonths(start, m.month), owed: m.owed }))],
    };
  };
  const simulating = input.extraCents > 0 || input.oneOff !== null;
  const base = run({});
  return { status: "ok", missing: [], base, simulated: simulating ? run(simOptions(input)) : base };
}

// ── Payoff plan ───────────────────────────────────────────────────────────

export interface PlanDebt extends ProjectableDebt { name: string }

export interface PayoffPlan {
  method: PayoffMethod;
  startMonth: string;
  included: { id: string; name: string; kind: string; owed: number; apr: number | null; minimumPayment: number }[];
  excluded: { id: string; name: string; kind: string; reason: "paid_in_full" | "needs_data"; missing: MissingField[] }[];
  plan: (Scenario & {
    payoffOrder: { id: string; name: string; monthPaidOff: number; payoffMonth: string }[];
    series: { month: string; owed: number; debts: { id: string; owed: number }[] }[];
  }) | null;
  other: (Scenario & { method: PayoffMethod }) | null;               // the other method, same extra and one-off
  minimumsOnly: (Scenario & { series: { month: string; owed: number }[] }) | null; // reference line
}

/** The plan for every visible active debt: the chosen method's series per
 *  debt, the other method's summary for the one-line comparison, and the
 *  "solo mínimos" reference (no extra, no one-off, nothing cascades). */
export function payoffPlan(debts: { debt: PlanDebt; ledger: DebtLedger }[], input: SimulatorInput, now: Date): PayoffPlan {
  const startMonth = monthKeyOf(now);
  const included: PayoffPlan["included"] = [];
  const excluded: PayoffPlan["excluded"] = [];
  const inputs: PayoffDebtInput[] = [];
  const names = new Map<string, string>();
  for (const { debt, ledger } of debts) {
    const owed = owedNow(ledger);
    const p = projectability(debt, owed);
    if (p.status === "ok") {
      inputs.push(p.input);
      names.set(debt.id, debt.name);
      included.push({ id: debt.id, name: debt.name, kind: debt.kind, owed, apr: debt.apr, minimumPayment: p.input.minimumPayment! });
    } else if (p.status === "paid_in_full" || p.status === "needs_data") {
      excluded.push({ id: debt.id, name: debt.name, kind: debt.kind, reason: p.status, missing: p.status === "needs_data" ? p.missing : [] });
    }
  }
  if (inputs.length === 0) return { method: input.method, startMonth, included, excluded, plan: null, other: null, minimumsOnly: null };

  const otherMethod: PayoffMethod = input.method === "snowball" ? "avalanche" : "snowball";
  const chosen = simulatePayoffSeries(inputs, input.method, simOptions(input));
  const other = simulatePayoffSeries(inputs, otherMethod, simOptions(input));
  const minimums = simulatePayoffSeries(inputs, input.method, { cascade: false });
  const totalOwed = included.reduce((s, d) => s + d.owed, 0);

  return {
    method: input.method,
    startMonth,
    included,
    excluded,
    plan: {
      ...scenarioOf(chosen, startMonth),
      payoffOrder: chosen.payoffOrder.map(p => ({
        id: p.id, name: names.get(p.id) ?? "", monthPaidOff: p.monthPaidOff, payoffMonth: addMonths(startMonth, p.monthPaidOff),
      })),
      series: [
        { month: startMonth, owed: totalOwed, debts: included.map(d => ({ id: d.id, owed: d.owed })) },
        ...chosen.series.map(m => ({ month: addMonths(startMonth, m.month), owed: m.owed, debts: m.debts.map(x => ({ id: x.id, owed: x.owed })) })),
      ],
    },
    other: { method: otherMethod, ...scenarioOf(other, startMonth) },
    minimumsOnly: {
      ...scenarioOf(minimums, startMonth),
      series: [{ month: startMonth, owed: totalOwed }, ...minimums.series.map(m => ({ month: addMonths(startMonth, m.month), owed: m.owed }))],
    },
  };
}
