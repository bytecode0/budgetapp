// Debt detail and payoff plan charts (LPBETA-02). Pure: the routes in
// server/routes/debts.ts load the rows and call these. Everything in cents;
// serializeMoney converts at the response edge.
//
// Rules:
//  1. Months. The projection starts in the CURRENT month when this budget
//     period's payment of a debt (monthlyCommitment) isn't paid yet, else in
//     the next one. In a plan, a debt already paid this period sits out the
//     current month. So a BNPL with its Nov/Dec/Jan cuotas unpaid ends in
//     January both before and after paying November. The one-off month
//     counts from that first projected month.
//  2. What can be projected. A debt needs a monthly payment (minimumPayment,
//     else installmentAmount, > 0). A debt paid by its minimum also needs its
//     APR (TAE): without it the simulation would invent a date. An installment
//     plan never uses its APR: its cuotas already carry the interest. With its
//     cuota count known it ends exactly after its remaining cuotas (the last
//     may be smaller). A missing datum is reported (`missing`), never guessed.
//  3. A debt in "full" payment mode (a card paid in full every month) isn't
//     debt to pay down over time: it's left out of every projection.
//  4. Cards: the projection assumes no new purchases (the UI says so).
//  5. The simulator is only for looking: nothing here writes anything.
import type { DebtLedger } from "./debtBalance.js";
import { debtState, monthlyCommitment, owedNow } from "./debtBalance.js";
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
  oneOff: { monthKey: string; amountCents: number } | null; // "YYYY-MM"
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
  if (oneOffCents === 0) return { method, extraCents, oneOff: null };

  const raw = query.oneOffMonth;
  if (typeof raw !== "string" || !MONTH.test(raw)) return { error: "oneOffMonth must be YYYY-MM", code: "invalid_month" };
  // Checked again against the first projected month (oneOffAt).
  const month = monthsBetween(monthKeyOf(now), raw);
  if (month < 0 || month >= PAYOFF_MAX_MONTHS) return { error: "oneOffMonth must be from this month on", code: "invalid_month" };
  return { method, extraCents, oneOff: { monthKey: raw, amountCents: oneOffCents } };
}

const ONE_OFF_TOO_EARLY: SimulatorInputError = { error: "oneOffMonth is before the first projected month", code: "invalid_month" };

/** The engine's one-off (simulated month ≥ 1 counted from `firstMonth`), or
 *  an error when it falls before it (this month's payment is already made). */
function oneOffAt(input: SimulatorInput, firstMonth: string): PayoffOptions["oneOff"] | SimulatorInputError {
  if (!input.oneOff) return null;
  const month = monthsBetween(firstMonth, input.oneOff.monthKey) + 1;
  return month < 1 ? ONE_OFF_TOO_EARLY : { month, amountCents: input.oneOff.amountCents };
}

// ── This period's payment ─────────────────────────────────────────────────

/** Whether this budget period's payment of the debt is made: payments booked
 *  in the period cover its commitment (server/lib/debtBalance.ts). A debt
 *  committing nothing this period has nothing pending. */
export function paidThisPeriod(ledger: DebtLedger, period: { start: Date; end: Date }): boolean {
  const due = monthlyCommitment(ledger, period);
  const paid = ledger.payments.filter(p => p.date >= period.start && p.date < period.end).reduce((s, p) => s + p.amount, 0);
  return due <= 0 || paid >= due;
}

// ── What can be projected ─────────────────────────────────────────────────

export interface ProjectableDebt {
  id: string;
  kind: string;
  paymentMode: string;
  apr: number | null;
  minimumPayment: number | null; // cents
  installmentAmount: number | null; // cents
  installmentsTotal?: number | null;
}

export type MissingField = "apr" | "minimum";
export type Projectability =
  | { status: "ok"; input: PayoffDebtInput }
  | { status: "paid_in_full" }
  | { status: "nothing_owed" }
  | { status: "needs_data"; missing: MissingField[] };

/** Rules 2 and 3 for one debt owing `owedCents`, with `installmentsPaid`
 *  cuotas paid (live count, debtState). */
export function projectability(d: ProjectableDebt, owedCents: number, installmentsPaid = 0): Projectability {
  if (d.paymentMode === "full") return { status: "paid_in_full" };
  if (owedCents <= 0) return { status: "nothing_owed" };
  const minimum = d.minimumPayment ?? d.installmentAmount;
  const missing: MissingField[] = [];
  if (d.paymentMode !== "installments" && d.apr == null) missing.push("apr");
  if (!minimum || minimum <= 0) missing.push("minimum");
  if (missing.length > 0) return { status: "needs_data", missing };
  const installments = d.paymentMode === "installments";
  return {
    status: "ok",
    input: {
      id: d.id, currentBalance: owedCents, apr: installments ? 0 : d.apr ?? 0, minimumPayment: minimum!, installmentAmount: null,
      paymentsLeft: installments && d.installmentsTotal != null ? Math.max(1, d.installmentsTotal - installmentsPaid) : null,
    },
  };
}

const projectabilityOf = (d: ProjectableDebt, ledger: DebtLedger) =>
  projectability(d, owedNow(ledger), debtState(ledger).installmentsPaid);

// ── Scenario (one simulation, dated) ──────────────────────────────────────

export interface Scenario {
  months: number;
  converged: boolean;
  payoffMonth: string | null; // "YYYY-MM" when it converges
  totalInterestPaid: number;
  totalPaid: number;
}

/** Simulated month k is calendar month firstMonth + k − 1. */
export function scenarioOf(sim: PayoffSeries, firstMonth: string): Scenario {
  return {
    months: sim.months,
    converged: sim.converged,
    payoffMonth: sim.converged && sim.months > 0 ? addMonths(firstMonth, sim.months - 1) : null,
    totalInterestPaid: sim.totalInterestPaid,
    totalPaid: sim.totalPaid,
  };
}

const isError = (x: unknown): x is SimulatorInputError => !!x && typeof x === "object" && "code" in x;

/** The dated points of a simulation for a chart: today's balance in the
 *  current month, then each later month's end balance. */
function datedSeries<T extends { month: number }>(sim: { series: T[] }, firstMonth: string, current: string) {
  return sim.series
    .map(m => ({ key: addMonths(firstMonth, m.month - 1), m }))
    .filter(x => x.key > current);
}

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
  firstMonth: string; // the first projected month: this month while its payment is pending
  missing: MissingField[];
  base: (Scenario & { series: { month: string; owed: number }[] }) | null;      // minimum only
  simulated: (Scenario & { series: { month: string; owed: number }[] }) | null; // with extra / one-off
}

/** The projection of one debt: as it goes (its own payment) and with the
 *  simulator's extra and one-off. Each series starts at the current month. */
export function debtProjection(
  d: ProjectableDebt, ledger: DebtLedger, input: SimulatorInput, now: Date, period: { start: Date; end: Date },
): DetailProjection | SimulatorInputError {
  const owed = owedNow(ledger);
  const current = monthKeyOf(now);
  const firstMonth = paidThisPeriod(ledger, period) ? addMonths(current, 1) : current;
  const oneOff = oneOffAt(input, firstMonth);
  if (isError(oneOff)) return oneOff;
  const p = projectabilityOf(d, ledger);
  if (p.status !== "ok") return { status: p.status, firstMonth, missing: p.status === "needs_data" ? p.missing : [], base: null, simulated: null };
  const run = (options: PayoffOptions) => {
    const sim = simulatePayoffSeries([p.input], "avalanche", options);
    return {
      ...scenarioOf(sim, firstMonth),
      series: [{ month: current, owed }, ...datedSeries(sim, firstMonth, current).map(x => ({ month: x.key, owed: x.m.owed }))],
    };
  };
  const simulating = input.extraCents > 0 || oneOff !== null;
  const base = run({});
  return { status: "ok", firstMonth, missing: [], base, simulated: simulating ? run({ extraPaymentCents: input.extraCents, oneOff }) : base };
}

// ── Payoff plan ───────────────────────────────────────────────────────────

export interface PlanDebt extends ProjectableDebt { name: string }

export interface PayoffPlan {
  method: PayoffMethod;
  startMonth: string;
  firstMonth: string; // the first projected month: this month while any payment is pending
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
export function payoffPlan(
  debts: { debt: PlanDebt; ledger: DebtLedger }[], input: SimulatorInput, now: Date, period: { start: Date; end: Date },
): PayoffPlan | SimulatorInputError {
  const startMonth = monthKeyOf(now);
  const included: PayoffPlan["included"] = [];
  const excluded: PayoffPlan["excluded"] = [];
  const inputs: PayoffDebtInput[] = [];
  const names = new Map<string, string>();
  for (const { debt, ledger } of debts) {
    const owed = owedNow(ledger);
    const p = projectabilityOf(debt, ledger);
    if (p.status === "ok") {
      inputs.push({ ...p.input, skipFirstMonth: paidThisPeriod(ledger, period) });
      names.set(debt.id, debt.name);
      included.push({ id: debt.id, name: debt.name, kind: debt.kind, owed, apr: debt.apr, minimumPayment: p.input.minimumPayment! });
    } else if (p.status === "paid_in_full" || p.status === "needs_data") {
      excluded.push({ id: debt.id, name: debt.name, kind: debt.kind, reason: p.status, missing: p.status === "needs_data" ? p.missing : [] });
    }
  }
  // Starts this month while any debt's payment is pending; if all are paid,
  // next month, with nobody sitting out.
  const pending = inputs.some(i => !i.skipFirstMonth);
  const firstMonth = pending ? startMonth : addMonths(startMonth, 1);
  if (!pending) for (const i of inputs) i.skipFirstMonth = false;
  const oneOff = oneOffAt(input, firstMonth);
  if (isError(oneOff)) return oneOff;
  if (inputs.length === 0) return { method: input.method, startMonth, firstMonth, included, excluded, plan: null, other: null, minimumsOnly: null };

  const options: PayoffOptions = { extraPaymentCents: input.extraCents, oneOff };
  const otherMethod: PayoffMethod = input.method === "snowball" ? "avalanche" : "snowball";
  const chosen = simulatePayoffSeries(inputs, input.method, options);
  const other = simulatePayoffSeries(inputs, otherMethod, options);
  const minimums = simulatePayoffSeries(inputs, input.method, { cascade: false });
  const totalOwed = included.reduce((s, d) => s + d.owed, 0);

  return {
    method: input.method,
    startMonth,
    firstMonth,
    included,
    excluded,
    plan: {
      ...scenarioOf(chosen, firstMonth),
      payoffOrder: chosen.payoffOrder.map(p => ({
        id: p.id, name: names.get(p.id) ?? "", monthPaidOff: p.monthPaidOff, payoffMonth: addMonths(firstMonth, p.monthPaidOff - 1),
      })),
      series: [
        { month: startMonth, owed: totalOwed, debts: included.map(d => ({ id: d.id, owed: d.owed })) },
        ...datedSeries(chosen, firstMonth, startMonth).map(({ key, m }) => ({ month: key, owed: m.owed, debts: m.debts.map(x => ({ id: x.id, owed: x.owed })) })),
      ],
    },
    other: { method: otherMethod, ...scenarioOf(other, firstMonth) },
    minimumsOnly: {
      ...scenarioOf(minimums, firstMonth),
      series: [{ month: startMonth, owed: totalOwed }, ...datedSeries(minimums, firstMonth, startMonth).map(({ key, m }) => ({ month: key, owed: m.owed }))],
    },
  };
}
