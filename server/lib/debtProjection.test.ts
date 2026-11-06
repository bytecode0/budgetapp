// Run with:  node --import tsx --test server/lib/debtProjection.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DebtLedger } from "./debtBalance.js";
import {
  addMonths, monthsBetween, parseSimulatorQuery, projectability, pastBalances, debtProjection, payoffPlan,
  MAX_EXTRA_CENTS, type PlanDebt, type SimulatorInput, type SimulatorInputError, type DetailProjection, type PayoffPlan,
} from "./debtProjection.js";

const NOW = new Date("2026-11-06T12:00:00Z");
const D = (s: string) => new Date(`${s}T12:00:00.000Z`);
const NO_SIM: SimulatorInput = { method: "snowball", extraCents: 0, oneOff: null };
// The budget period containing NOW (calendar month here).
const PERIOD = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") };

function ok<T extends object>(r: T | SimulatorInputError): T {
  assert.ok(!("code" in r), `unexpected error ${JSON.stringify(r)}`);
  return r as T;
}
const detail = (d: PlanDebt, l: DebtLedger, input: SimulatorInput = NO_SIM) => ok<DetailProjection>(debtProjection(d, l, input, NOW, PERIOD));
const plan = (rows: { debt: PlanDebt; ledger: DebtLedger }[], input: SimulatorInput = NO_SIM) => ok<PayoffPlan>(payoffPlan(rows, input, NOW, PERIOD));

function ledger(over: Partial<DebtLedger["debt"]> = {}, moves: Partial<Omit<DebtLedger, "debt">> = {}): DebtLedger {
  return {
    debt: {
      id: "d1", kind: "installment", status: "active", paymentMode: "minimum", accountId: null,
      currentBalance: 100000, installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: 10000,
      balanceAsOf: D("2026-08-10"), ...over,
    },
    purchases: [], payments: [], adjustments: [], ...moves,
  };
}
const planDebt = (id: string, over: Partial<PlanDebt> = {}): PlanDebt =>
  ({ id, name: id, kind: "installment", paymentMode: "minimum", apr: 10, minimumPayment: 10000, installmentAmount: null, ...over });

test("months: add and count across years", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(monthsBetween("2026-11", "2028-02"), 15);
});

test("simulator query: defaults, euros to cents, caps and bad input", () => {
  assert.deepEqual(parseSimulatorQuery({}, NOW), NO_SIM);
  const parsed = parseSimulatorQuery({ method: "avalanche", extra: "50.25", oneOff: "1000", oneOffMonth: "2027-06" }, NOW);
  assert.deepEqual(parsed, { method: "avalanche", extraCents: 5025, oneOff: { monthKey: "2027-06", amountCents: 100000 } });
  // This month is accepted here; whether it's before the first projected month is decided with the debts.
  assert.equal("code" in parseSimulatorQuery({ oneOff: "1", oneOffMonth: "2026-11" }, NOW), false);
  // A zero one-off needs no month.
  assert.deepEqual(parseSimulatorQuery({ oneOff: "0", oneOffMonth: "nonsense" }, NOW), NO_SIM);
  for (const bad of [{ extra: "-5" }, { extra: "abc" }, { extra: "1e3" }, { extra: ["1", "2"] }, { extra: String(MAX_EXTRA_CENTS / 100 + 1) }, { oneOff: "99999999999" }, { extra: "1.234" }]) {
    assert.equal((parseSimulatorQuery(bad, NOW) as { code: string }).code, "invalid_amount", JSON.stringify(bad));
  }
  assert.equal((parseSimulatorQuery({ method: "random" }, NOW) as { code: string }).code, "invalid_method");
  for (const month of [undefined, "2026-10", "2026-13", "June", "2077-01"]) {
    assert.equal((parseSimulatorQuery({ oneOff: "100", oneOffMonth: month }, NOW) as { code: string }).code, "invalid_month", String(month));
  }
});

test("projectability: missing minimum or APR is reported, never guessed", () => {
  const base = { id: "x", kind: "installment", paymentMode: "minimum", apr: 10, minimumPayment: 5000, installmentAmount: null };
  assert.equal(projectability(base, 100).status, "ok");
  assert.deepEqual(projectability({ ...base, apr: null }, 100), { status: "needs_data", missing: ["apr"] });
  assert.deepEqual(projectability({ ...base, minimumPayment: null }, 100), { status: "needs_data", missing: ["minimum"] });
  assert.deepEqual(projectability({ ...base, apr: null, minimumPayment: 0 }, 100), { status: "needs_data", missing: ["apr", "minimum"] });
  // Explicit 0 % is data, not missing.
  assert.equal(projectability({ ...base, apr: 0 }, 100).status, "ok");
  // An installment plan's cuotas carry the interest: no APR needed.
  const plan = projectability({ ...base, paymentMode: "installments", apr: null, minimumPayment: null, installmentAmount: 2500 }, 100);
  assert.equal(plan.status, "ok");
  assert.equal(plan.status === "ok" && plan.input.apr, 0);
  assert.equal(projectability({ ...base, kind: "credit_card", paymentMode: "full" }, 100).status, "paid_in_full");
  assert.equal(projectability(base, 0).status, "nothing_owed");
});

test("past balances: one point per month from the anchor, the current month live", () => {
  const l = ledger({}, {
    payments: [{ id: "p1", amount: 10000, date: D("2026-09-05") }, { id: "p2", amount: 10000, date: D("2026-11-02") }],
    adjustments: [{ id: "a1", amount: 500, date: D("2026-10-20") }],
  });
  assert.deepEqual(pastBalances(l, NOW), [
    { month: "2026-08", owed: 100000 },
    { month: "2026-09", owed: 90000 },
    { month: "2026-10", owed: 90500 },
    { month: "2026-11", owed: 80500 },
  ]);
});

test("past balances: capped at the last 120 months", () => {
  const p = pastBalances(ledger({ balanceAsOf: D("2000-01-01") }), NOW);
  assert.equal(p.length, 120);
  assert.equal(p.at(-1)!.month, "2026-11");
});

test("detail projection: the simulator ends sooner and pays less interest; series starts at today's balance", () => {
  const d = planDebt("d1", { apr: 20 });
  const sim = detail(d, ledger(), { ...NO_SIM, extraCents: 5000, oneOff: { monthKey: "2027-01", amountCents: 20000 } });
  assert.equal(sim.status, "ok");
  assert.ok(sim.base && sim.simulated);
  assert.deepEqual(sim.base.series[0], { month: "2026-11", owed: 100000 });
  assert.ok(sim.simulated.months < sim.base.months);
  assert.ok(sim.simulated.totalInterestPaid < sim.base.totalInterestPaid);
  // Nothing paid this period: month 1 is November.
  assert.equal(sim.firstMonth, "2026-11");
  assert.equal(sim.base.payoffMonth, addMonths("2026-11", sim.base.months - 1));
  // Without simulator input, simulated is the base itself.
  const plain = detail(d, ledger());
  assert.equal(plain.simulated, plain.base);
});

test("detail projection: no date for a debt missing data or paid in full", () => {
  const missing = detail(planDebt("d1", { apr: null }), ledger());
  assert.deepEqual(missing, { status: "needs_data", firstMonth: "2026-11", missing: ["apr"], base: null, simulated: null });
  const full = detail(planDebt("d1", { kind: "credit_card", paymentMode: "full" }), ledger({ kind: "credit_card", paymentMode: "full" }));
  assert.equal(full.status, "paid_in_full");
  assert.equal(full.base, null);
});

test("detail projection: a payment below the interest never converges, so no payoff month", () => {
  const r = detail(planDebt("d1", { apr: 300, minimumPayment: 100 }), ledger());
  assert.equal(r.base!.converged, false);
  assert.equal(r.base!.payoffMonth, null);
});

test("plan: leaves out cards paid in full and debts missing data, compares methods, minimums-only reference", () => {
  const rows = [
    { debt: planDebt("small", { apr: 5, minimumPayment: 2000 }), ledger: ledger({ id: "small", currentBalance: 30000 }) },
    { debt: planDebt("big", { apr: 25, minimumPayment: 3000 }), ledger: ledger({ id: "big", currentBalance: 200000 }) },
    { debt: planDebt("card", { kind: "credit_card", paymentMode: "full" }), ledger: ledger({ id: "card", kind: "credit_card", paymentMode: "full" }) },
    { debt: planDebt("nomin", { minimumPayment: null }), ledger: ledger({ id: "nomin" }) },
  ];
  const sb = plan(rows, { ...NO_SIM, extraCents: 10000 });
  assert.deepEqual(sb.included.map(d => d.id), ["small", "big"]);
  assert.deepEqual(sb.excluded.map(d => [d.id, d.reason, d.missing]), [["card", "paid_in_full", []], ["nomin", "needs_data", ["minimum"]]]);
  assert.equal(sb.plan!.payoffOrder[0].id, "small");
  assert.equal(sb.plan!.series[0].owed, 230000);
  assert.equal(sb.plan!.series.at(-1)!.owed, 0);
  assert.equal(sb.plan!.payoffMonth, addMonths("2026-11", sb.plan!.months - 1));
  assert.equal(sb.other!.method, "avalanche");
  assert.ok(sb.other!.totalInterestPaid <= sb.plan!.totalInterestPaid);
  assert.ok(sb.minimumsOnly!.months > sb.plan!.months);
  assert.ok(sb.minimumsOnly!.totalInterestPaid > sb.plan!.totalInterestPaid);

  const av = plan(rows, { ...NO_SIM, method: "avalanche", extraCents: 10000 });
  // Month 1: avalanche puts the extra on the high-APR debt, snowball on the smallest.
  const firstMonth = (r: typeof sb, id: string) => r.plan!.series[1].debts.find(d => d.id === id)!.owed;
  assert.ok(firstMonth(av, "big") < firstMonth(sb, "big"));
  assert.ok(firstMonth(sb, "small") < firstMonth(av, "small"));
  assert.equal(av.plan!.totalInterestPaid, sb.other!.totalInterestPaid);
});

test("plan: nothing projectable gives no plan (the screen asks for the data)", () => {
  const r = plan([{ debt: planDebt("x", { apr: null }), ledger: ledger({ id: "x" }) }]);
  assert.equal(r.plan, null);
  assert.equal(r.excluded.length, 1);
});

// ── Installment plans (review) ─────────────────────────────────────────────

const cuotas = (over: Partial<PlanDebt> = {}): PlanDebt =>
  planDebt("plan", { kind: "bnpl", paymentMode: "installments", minimumPayment: null, installmentAmount: 10000, installmentsTotal: 12, ...over });
const cuotasLedger = (balance: number, moves: Partial<Omit<DebtLedger, "debt">> = {}, over: Partial<DebtLedger["debt"]> = {}) =>
  ledger({ id: "plan", kind: "bnpl", paymentMode: "installments", currentBalance: balance, minimumPayment: null, installmentAmount: 10000, installmentsTotal: 12, balanceAsOf: D("2026-10-20"), ...over }, moves);

test("installments: 12 × 100 ends in 12 months with no interest, whatever the APR", () => {
  for (const apr of [null, 10, 20, 30]) {
    const r = detail(cuotas({ apr }), cuotasLedger(120000));
    assert.equal(r.status, "ok", String(apr));
    assert.equal(r.base!.months, 12, String(apr));
    assert.equal(r.base!.totalInterestPaid, 0, String(apr));
    assert.equal(r.base!.payoffMonth, "2027-10", String(apr)); // Nov 2026 … Oct 2027
  }
});

test("installments: the plan ends exactly after the remaining cuotas (the last one settles the rest)", () => {
  // 3 of 12 paid before the anchor: 9 left. A balance that doesn't divide evenly still ends on cuota 9.
  for (const balance of [85000, 90000, 95000]) {
    const r = detail(cuotas(), cuotasLedger(balance, {}, { installmentsPaid: 3 }));
    assert.equal(r.base!.months, 9, String(balance));
    assert.equal(r.base!.totalPaid, balance);
  }
});

test("month 0: a BNPL with Nov/Dec/Jan unpaid ends in January, before and after paying November", () => {
  const debt = cuotas({ installmentAmount: 5000, installmentsTotal: 3 });
  const over = { installmentAmount: 5000, installmentsTotal: 3 };
  const before = detail(debt, cuotasLedger(15000, {}, over));
  assert.equal(before.firstMonth, "2026-11");
  assert.equal(before.base!.months, 3);
  assert.equal(before.base!.payoffMonth, "2027-01");

  const after = detail(debt, cuotasLedger(15000, { payments: [{ id: "p", amount: 5000, date: D("2026-11-03") }] }, over));
  assert.equal(after.firstMonth, "2026-12");
  assert.equal(after.base!.months, 2);
  assert.equal(after.base!.payoffMonth, "2027-01");
  // The chart starts at today's balance in the current month either way.
  assert.deepEqual(before.base!.series[0], { month: "2026-11", owed: 15000 });
  assert.deepEqual(after.base!.series[0], { month: "2026-11", owed: 10000 });
  assert.deepEqual(before.base!.series.map(p => p.month), ["2026-11", "2026-12", "2027-01"]);
});

test("month 0: the one-off month counts from the first projected month", () => {
  const debt = planDebt("d1", { apr: 0, minimumPayment: 10000 });
  const oneOffNov = { ...NO_SIM, oneOff: { monthKey: "2026-11", amountCents: 50000 } };
  // November still to pay: a November one-off lands in month 1.
  const pending = detail(debt, ledger(), oneOffNov);
  assert.equal(pending.simulated!.months, 5); // 100000: 10000 + 50000 in Nov, then 4 × 10000
  assert.equal(pending.simulated!.payoffMonth, "2027-03");
  // November already paid: a November one-off is before the first projected month.
  const paid = ledger({}, { payments: [{ id: "p", amount: 10000, date: D("2026-11-02") }] });
  assert.equal((debtProjection(debt, paid, oneOffNov, NOW, PERIOD) as SimulatorInputError).code, "invalid_month");
  const dec = detail(debt, paid, { ...NO_SIM, oneOff: { monthKey: "2026-12", amountCents: 50000 } });
  assert.equal(dec.firstMonth, "2026-12");
  assert.equal(dec.simulated!.payoffMonth, "2027-03"); // 90000: 60000 in Dec, then 3 × 10000
});

test("month 0 in a plan: a debt already paid this period sits out November; all paid → starts in December", () => {
  const paidRow = { debt: planDebt("paid", { apr: 0, minimumPayment: 10000 }), ledger: ledger({ id: "paid", currentBalance: 30000 }, { payments: [{ id: "p", amount: 10000, date: D("2026-11-02") }] }) };
  const pendingRow = { debt: planDebt("pending", { apr: 0, minimumPayment: 10000 }), ledger: ledger({ id: "pending", currentBalance: 20000 }) };
  const mixed = plan([paidRow, pendingRow]);
  assert.equal(mixed.firstMonth, "2026-11");
  const at = (r: PayoffPlan, id: string) => r.plan!.payoffOrder.find(p => p.id === id)!.payoffMonth;
  assert.equal(at(mixed, "pending"), "2026-12"); // Nov + Dec
  assert.equal(at(mixed, "paid"), "2027-01");    // 20000 left: Dec and Jan (Dec's budget is only the two minimums)
  const allPaid = plan([paidRow]);
  assert.equal(allPaid.firstMonth, "2026-12");
  assert.equal(at(allPaid, "paid"), "2027-01");
});
