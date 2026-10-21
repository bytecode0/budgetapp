// Run with:  node --import tsx --test server/lib/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveOnboardingStatus, isUntouchedDefaultAccount, computeOnboardingResult, DEFAULT_ACCOUNT_NAME,
  type StatusInput, type StatusAccount, type ResultDebt,
} from "./onboarding.js";
import { owedNow, startingBalanceFor, type LedgerDebt } from "./debtBalance.js";

// ── Checklist ──────────────────────────────────────────────────────────────

const defaultAccount: StatusAccount = {
  id: "main", type: "checking", name: DEFAULT_ACCOUNT_NAME, currentBalance: 0, isArchived: false, bankConnectionId: null,
};
// A brand-new user: only what signup seeds (default account + 0 € default lines).
const fresh: StatusInput = {
  monthlyIncome: 0,
  incomeCount: 0,
  accounts: [defaultAccount],
  debts: [],
  allocations: [{ type: "fixed", allocatedAmount: 0 }, { type: "flexible", allocatedAmount: 0 }],
};

test("a brand-new user needs the onboarding and is missing every step", () => {
  const s = deriveOnboardingStatus(fresh);
  assert.equal(s.needsOnboarding, true);
  assert.deepEqual(s.checklist, { hasIncome: false, hasBankAccount: false, hasCards: false, hasDebts: false, hasFixedBudget: false });
  assert.deepEqual(s.missing, ["income", "bank", "cards", "loans", "fixed"]);
});

test("the untouched default account: exactly as seeded, nothing else", () => {
  assert.equal(isUntouchedDefaultAccount(defaultAccount), true);
  assert.equal(isUntouchedDefaultAccount({ ...defaultAccount, name: "BBVA" }), false);
  assert.equal(isUntouchedDefaultAccount({ ...defaultAccount, currentBalance: 80000 }), false);
  assert.equal(isUntouchedDefaultAccount({ ...defaultAccount, bankConnectionId: "conn" }), false);
  assert.equal(isUntouchedDefaultAccount({ ...defaultAccount, type: "savings" }), false);
});

test("hasBankAccount ignores the untouched default and archived accounts", () => {
  assert.equal(deriveOnboardingStatus(fresh).checklist.hasBankAccount, false);
  const renamed = { ...fresh, accounts: [{ ...defaultAccount, name: "BBVA", currentBalance: 80000 }] };
  assert.equal(deriveOnboardingStatus(renamed).checklist.hasBankAccount, true);
  const archived = { ...fresh, accounts: [{ ...defaultAccount, name: "BBVA", isArchived: true }] };
  assert.equal(deriveOnboardingStatus(archived).checklist.hasBankAccount, false);
  const savingsOnly = { ...fresh, accounts: [defaultAccount, { ...defaultAccount, type: "cash", name: "Ahorros", currentBalance: 300000 }] };
  assert.equal(deriveOnboardingStatus(savingsOnly).checklist.hasBankAccount, false);
});

test("cards count by their account; loans exclude the card's own debt", () => {
  const withCard: StatusInput = {
    ...fresh,
    accounts: [defaultAccount, { ...defaultAccount, type: "card", name: "PASS" }],
    debts: [{ kind: "credit_card", status: "active" }],
  };
  const s = deriveOnboardingStatus(withCard);
  assert.equal(s.checklist.hasCards, true);
  assert.equal(s.checklist.hasDebts, false);
  assert.equal(deriveOnboardingStatus({ ...withCard, debts: [{ kind: "credit_card", status: "active" }, { kind: "bnpl", status: "active" }] }).checklist.hasDebts, true);
});

test("a fixed budget needs a fixed line with an amount", () => {
  assert.equal(deriveOnboardingStatus({ ...fresh, allocations: [{ type: "flexible", allocatedAmount: 30000 }] }).checklist.hasFixedBudget, false);
  assert.equal(deriveOnboardingStatus({ ...fresh, allocations: [{ type: "fixed", allocatedAmount: 70000 }] }).checklist.hasFixedBudget, true);
});

test("a mortgage held as a debt covers the fixed budget (housing)", () => {
  assert.equal(deriveOnboardingStatus({ ...fresh, debts: [{ kind: "mortgage", status: "active" }] }).checklist.hasFixedBudget, true);
  assert.equal(deriveOnboardingStatus({ ...fresh, debts: [{ kind: "mortgage", status: "paid_off" }] }).checklist.hasFixedBudget, false);
  assert.equal(deriveOnboardingStatus({ ...fresh, debts: [{ kind: "auto_loan", status: "active" }] }).checklist.hasFixedBudget, false);
});

test("defaultAccountId: only the untouched seeded account, never a bank-linked one", () => {
  assert.equal(deriveOnboardingStatus(fresh).defaultAccountId, "main");
  assert.equal(deriveOnboardingStatus({ ...fresh, accounts: [{ ...defaultAccount, name: "BBVA" }] }).defaultAccountId, null);
  assert.equal(deriveOnboardingStatus({ ...fresh, accounts: [{ ...defaultAccount, bankConnectionId: "conn" }] }).defaultAccountId, null);
  assert.equal(deriveOnboardingStatus({ ...fresh, accounts: [{ ...defaultAccount, isArchived: true }] }).defaultAccountId, null);
});

test("abandoned at the cards step: no wizard, the checklist points at cards", () => {
  const s = deriveOnboardingStatus({
    ...fresh,
    monthlyIncome: 200000,
    incomeCount: 1,
    accounts: [{ ...defaultAccount, name: "BBVA", currentBalance: 80000 }, { ...defaultAccount, type: "cash", name: "Ahorros", currentBalance: 300000 }],
  });
  assert.equal(s.needsOnboarding, false);
  assert.deepEqual(s.missing, ["cards", "loans", "fixed"]);
});

test("only a budget configured still counts as configured", () => {
  const s = deriveOnboardingStatus({ ...fresh, allocations: [{ type: "flexible", allocatedAmount: 30000 }] });
  assert.equal(s.needsOnboarding, false);
});

// ── Result ─────────────────────────────────────────────────────────────────

const debt = (d: Partial<LedgerDebt> & { id: string; kind: string }, name: string, apr: number | null = null): ResultDebt => ({
  name,
  apr,
  ledger: {
    debt: {
      status: "active", paymentMode: "installments", accountId: null, currentBalance: 0,
      installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: null, ...d,
    },
    purchases: [], payments: [], adjustments: [],
  },
});

// A plan as POST /api/debts stores it: entered with only its cuota, it gets
// its remaining cuotas as starting balance.
const created = (d: Partial<LedgerDebt> & { id: string; kind: string }, name: string) => debt({
  ...d,
  currentBalance: startingBalanceFor({
    paymentMode: d.paymentMode ?? "installments",
    currentBalance: d.currentBalance ?? 0,
    installmentAmount: d.installmentAmount ?? null,
    installmentsTotal: d.installmentsTotal ?? null,
    installmentsPaid: d.installmentsPaid ?? 0,
  }),
}, name);

// Plan §3.3: 2.000 € on day 1, PASS paid in full owing 300 €, Klarna 6×50 € with 2 paid.
const pass = debt({ id: "pass", kind: "credit_card", paymentMode: "full", accountId: "acc-pass", currentBalance: 30000 }, "PASS");
const klarna = debt({ id: "klarna", kind: "bnpl", installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 2, currentBalance: 20000 }, "Klarna");

test("plan §3.3: futuro comprometido = (300 + 50) / 2000 = 17.5 %", () => {
  const r = computeOnboardingResult({
    debts: [pass, klarna],
    monthlyIncome: 200000,
    cycleStartDay: 1,
    allocations: [
      { type: "debt", allocatedAmount: 30000 },
      { type: "debt", allocatedAmount: 5000 },
      { type: "fixed", allocatedAmount: 70000 },   // rent
      { type: "flexible", allocatedAmount: 30000 }, // groceries
    ],
  });
  assert.equal(r.committed, 35000);
  assert.equal(r.pctCommitted, 17.5);
  assert.equal(r.totalOwed, 50000);
  // Debt lines aren't counted twice: 2000 − 350 − (700 + 300) = 650.
  assert.equal(r.budgeted, 100000);
  assert.equal(r.leftover, 65000);
  // Snowball with 350 €/month: month 1 clears the PASS (300) and pays one
  // Klarna cuota (150 left); month 2 the freed 300 rolls over and finishes it.
  assert.equal(r.freedomMonths, 2);
  assert.deepEqual(r.payoffOrder.map(p => p.name).sort(), ["Klarna", "PASS"]);
});

test("an installment plan entered with only its cuota still owes its remaining cuotas", () => {
  const noBalance = created({ id: "k", kind: "bnpl", installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 2 }, "Klarna");
  const r = computeOnboardingResult({ debts: [noBalance], monthlyIncome: 200000, cycleStartDay: 1, allocations: [] });
  assert.equal(r.committed, 5000);
  assert.equal(r.freedomMonths, 4); // 4 × 50 €
});

test("mortgage counts as committed and owed, but not in the freedom date", () => {
  const mortgage = debt({ id: "m", kind: "mortgage", installmentAmount: 60000, currentBalance: 12000000 }, "Hipoteca", 3);
  const r = computeOnboardingResult({ debts: [mortgage], monthlyIncome: 200000, cycleStartDay: 1, allocations: [] });
  assert.equal(r.committed, 60000);
  assert.equal(r.totalOwed, 12000000);
  assert.equal(r.freedomMonths, null);
  assert.deepEqual(r.payoffOrder, []);
});

test("no income: 0 % rather than a division by zero; leftover goes negative", () => {
  const r = computeOnboardingResult({ debts: [klarna], monthlyIncome: 0, cycleStartDay: 1, allocations: [{ type: "fixed", allocatedAmount: 10000 }] });
  assert.equal(r.pctCommitted, 0);
  assert.equal(r.leftover, -15000);
});

test("paid-off debts are ignored", () => {
  const done = debt({ id: "x", kind: "installment", status: "paid_off", installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 6 }, "Old");
  const r = computeOnboardingResult({ debts: [done], monthlyIncome: 200000, cycleStartDay: 1, allocations: [] });
  assert.equal(r.committed, 0);
  assert.equal(r.totalOwed, 0);
  assert.equal(r.freedomMonths, null);
});

// ── One definition of "owed" ───────────────────────────────────────────────

test("owedNow: a plan created without a balance owes its remaining cuotas, then follows its payments", () => {
  const noBalance = created({ id: "k", kind: "bnpl", installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 2 }, "Klarna");
  assert.equal(owedNow(noBalance.ledger), 20000); // 4 × 50 €
  // A payment since then is one cuota fewer.
  assert.equal(owedNow({ ...noBalance.ledger, payments: [{ id: "p", amount: 5000, date: new Date() }] }), 15000);
  // With a balance, the live balance is what's owed.
  assert.equal(owedNow(klarna.ledger), 20000);
  assert.equal(owedNow(pass.ledger), 30000);
});

test("total owed and the payoff agree for a plan entered without a balance", () => {
  const noBalance = created({ id: "k", kind: "bnpl", installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 2 }, "Klarna");
  const r = computeOnboardingResult({ debts: [noBalance], monthlyIncome: 200000, cycleStartDay: 1, allocations: [] });
  assert.equal(r.totalOwed, 20000);
  assert.equal(r.freedomMonths, 4);
  assert.equal(r.hasConsumerDebt, true);
});

test("plan §3.3 as a user enters it (Klarna with no balance): 500 € owed, 17.5 %", () => {
  const klarnaAsEntered = created({ id: "klarna", kind: "bnpl", installmentAmount: 5000, installmentsTotal: 6, installmentsPaid: 2 }, "Klarna");
  const r = computeOnboardingResult({
    debts: [pass, klarnaAsEntered],
    monthlyIncome: 200000,
    cycleStartDay: 1,
    allocations: [{ type: "fixed", allocatedAmount: 70000 }, { type: "flexible", allocatedAmount: 30000 }],
  });
  assert.equal(r.committed, 35000);
  assert.equal(r.pctCommitted, 17.5);
  assert.equal(r.totalOwed, 50000);
  assert.equal(r.leftover, 65000);
  assert.equal(r.freedomMonths, 2);
});

test("debt that current payments never pay off: consumer debt, but no freedom date", () => {
  // A card on "minimum" with the minimum left blank: 1,500 € at 24 % only grows.
  const card = debt({ id: "c", kind: "credit_card", paymentMode: "minimum", accountId: "acc", currentBalance: 150000 }, "Visa", 24);
  const r = computeOnboardingResult({ debts: [card], monthlyIncome: 200000, cycleStartDay: 1, allocations: [] });
  assert.equal(r.hasConsumerDebt, true);
  assert.equal(r.freedomMonths, null);
});

test("no consumer debt: the flag is off", () => {
  const r = computeOnboardingResult({ debts: [], monthlyIncome: 200000, cycleStartDay: 1, allocations: [] });
  assert.equal(r.hasConsumerDebt, false);
  assert.equal(r.freedomMonths, null);
});
