// The onboarding's derived state (docs/plan-deudas-y-onboarding.md, epic 3).
// Pure functions over already-loaded rows, so they're unit-testable without a
// database; server/routes/onboarding.ts does the loading.
//
// Nothing here is a stored flag: "what's still missing" is recomputed from
// the user's real data on every read, so deleting something brings its step
// back into the checklist.
import { debtState, monthlyCommitment, type DebtLedger } from "./debtBalance.js";
import { buildDebtTimeline } from "./debtTimeline.js";
import { simulatePayoff } from "./debtPayoff.js";
import { currentPeriodKey, periodBounds } from "./period.js";

/** Name of the checking account every user gets on first load (server/lib/defaults.ts). */
export const DEFAULT_ACCOUNT_NAME = "Main account";

/** Wizard steps, by index (0 = welcome … 8 = result). */
export const ONBOARDING_STEPS = [
  "welcome", "income", "savings", "bank", "cards", "loans", "fixed", "flexible", "result",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface StatusAccount {
  type: string;
  name: string;
  currentBalance: number; // cents
  isArchived: boolean;
  bankConnectionId: string | null;
}

export interface StatusInput {
  monthlyIncome: number; // cents (UserSettings)
  incomeCount: number;
  accounts: StatusAccount[];
  debts: { kind: string }[];
  allocations: { type: string; allocatedAmount: number }[];
}

export interface OnboardingChecklist {
  hasIncome: boolean;
  hasBankAccount: boolean;
  hasCards: boolean;
  hasDebts: boolean;
  hasFixedBudget: boolean;
}

export interface OnboardingStatus {
  needsOnboarding: boolean;
  checklist: OnboardingChecklist;
  missing: OnboardingStep[]; // in wizard order — the steps that would fill each gap
}

/** The default "Main account" exactly as the server seeded it: never renamed,
 *  no balance entered, not linked to a bank. It exists for every user, so it
 *  says nothing about whether they told us about their bank account. */
export function isUntouchedDefaultAccount(a: StatusAccount): boolean {
  return a.type === "checking"
    && a.name === DEFAULT_ACCOUNT_NAME
    && a.currentBalance === 0
    && a.bankConnectionId === null;
}

const CHECKLIST_STEP: Record<keyof OnboardingChecklist, OnboardingStep> = {
  hasIncome: "income",
  hasBankAccount: "bank",
  hasCards: "cards",
  hasDebts: "loans",
  hasFixedBudget: "fixed",
};

export function deriveOnboardingStatus(input: StatusInput): OnboardingStatus {
  const open = input.accounts.filter(a => !a.isArchived);
  const checklist: OnboardingChecklist = {
    hasIncome: input.monthlyIncome > 0 || input.incomeCount > 0,
    hasBankAccount: open.some(a => a.type === "checking" && !isUntouchedDefaultAccount(a)),
    hasCards: open.some(a => a.type === "card"),
    // Loans and installment plans; a card's debt is covered by hasCards.
    hasDebts: input.debts.some(d => d.kind !== "credit_card"),
    hasFixedBudget: input.allocations.some(a => a.type === "fixed" && a.allocatedAmount > 0),
  };
  const missing = (Object.keys(CHECKLIST_STEP) as (keyof OnboardingChecklist)[])
    .filter(k => !checklist[k])
    .map(k => CHECKLIST_STEP[k]);
  // Nothing configured at all → the full wizard; otherwise the dashboard's
  // "Completa tu configuración" card covers what's left.
  const anyBudget = input.allocations.some(a => a.allocatedAmount > 0);
  const needsOnboarding = missing.length === Object.keys(CHECKLIST_STEP).length && !anyBudget;
  return { needsOnboarding, checklist, missing };
}

// ── Result step ────────────────────────────────────────────────────────────

// Método Ruta R3.1: the debts the payoff ("fecha de libertad") is about.
const CONSUMER_DEBT_KINDS = new Set(["credit_card", "installment", "bnpl", "payday_loan", "auto_loan", "student_loan"]);

export interface ResultDebt {
  ledger: DebtLedger;
  name: string;
  apr: number | null;
}

export interface ResultInput {
  debts: ResultDebt[];
  monthlyIncome: number; // cents
  cycleStartDay: number;
  allocations: { type: string; allocatedAmount: number }[]; // cents
  now?: Date;
}

export interface OnboardingResult {
  monthlyIncome: number;   // cents
  committed: number;       // cents — this period's debt payments
  pctCommitted: number;    // "futuro comprometido", one decimal
  totalOwed: number;       // cents — every active debt, live
  freedomMonths: number | null; // months until consumer debt reaches 0
  payoffOrder: { id: string; name: string; monthPaidOff: number }[];
  budgeted: number;        // cents — non-debt budget lines (fixed, flexible…)
  leftover: number;        // cents — income − committed − budgeted (may be < 0)
}

/** What's still owed on a debt for the payoff simulation. A plan entered with
 *  only its cuota (no balance) still owes its remaining installments. */
function owedForPayoff(ledger: DebtLedger): number {
  const state = debtState(ledger);
  if (state.balance > 0) return state.balance;
  const d = ledger.debt;
  if (d.installmentAmount && d.installmentsTotal != null) {
    return Math.max(0, d.installmentsTotal - state.installmentsPaid) * d.installmentAmount;
  }
  return 0;
}

export function computeOnboardingResult(input: ResultInput): OnboardingResult {
  const period = periodBounds(currentPeriodKey(input.cycleStartDay, input.now), input.cycleStartDay);
  const active = input.debts.filter(d => d.ledger.debt.status === "active");

  // Same inputs as GET /api/debts/timeline: measured at the period's start; a
  // card paid in full commits exactly what its budget line holds.
  const timeline = buildDebtTimeline(
    input.debts.map(({ ledger, name }) => ({
      ...ledger.debt,
      name,
      installmentsPaid: debtState(ledger, period.start).installmentsPaid,
      previousRemaining: monthlyCommitment(ledger, period),
    })),
    input.monthlyIncome,
    input.cycleStartDay,
    1,
  );
  const committed = timeline[0]?.committed ?? 0;
  const pctCommitted = timeline[0]?.pctCommitted ?? 0;

  const totalOwed = active.reduce((s, d) => s + Math.max(0, debtState(d.ledger).balance), 0);

  // Snowball over consumer debt, as GET /api/debts/payoff?scope=consumer: a
  // card paid in full clears its whole balance each month.
  const consumer = active
    .filter(d => CONSUMER_DEBT_KINDS.has(d.ledger.debt.kind))
    .map(d => ({ ...d, owed: owedForPayoff(d.ledger) }))
    .filter(d => d.owed > 0);
  let freedomMonths: number | null = null;
  let payoffOrder: OnboardingResult["payoffOrder"] = [];
  if (consumer.length > 0) {
    const sim = simulatePayoff(consumer.map(d => ({
      id: d.ledger.debt.id,
      currentBalance: d.owed,
      apr: d.apr,
      minimumPayment: d.ledger.debt.paymentMode === "full" ? d.owed : d.ledger.debt.minimumPayment,
      installmentAmount: d.ledger.debt.installmentAmount,
    })), "snowball");
    const nameById = new Map(consumer.map(d => [d.ledger.debt.id, d.name]));
    // 600 is the simulation's cap: a budget that never amortizes has no date.
    freedomMonths = sim.months > 0 && sim.months < 600 ? sim.months : null;
    payoffOrder = sim.payoffOrder.map(p => ({ ...p, name: nameById.get(p.id) ?? "" }));
  }

  // Debt lines are already counted in `committed`.
  const budgeted = input.allocations.filter(a => a.type !== "debt").reduce((s, a) => s + a.allocatedAmount, 0);

  return {
    monthlyIncome: input.monthlyIncome,
    committed,
    pctCommitted,
    totalOwed,
    freedomMonths,
    payoffOrder,
    budgeted,
    leftover: input.monthlyIncome - committed - budgeted,
  };
}
