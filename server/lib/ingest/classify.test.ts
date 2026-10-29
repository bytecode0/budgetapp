// The ingest core's decisions, dedup, and the money it ends up counting.
// Run with:  node --import tsx --test server/lib/ingest/classify.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRows, type ClassifyAccount, type ClassifyDebt, type ExistingMovement, type PlannedRow } from "./classify.js";
import { debtLineError, planImportWrites, type ConfirmRow } from "./writes.js";
import { buildLedgers, countedFrom, debtState, type LedgerDebt, type LedgerExpense } from "../debtBalance.js";
import type { NormalizedRow } from "./types.js";
import { isGenericMerchant, preselectLearnedPayment, suggestLearnedPayments, type LearnedDebt } from "./learnedPayments.js";
import { normalizeMerchant } from "../normalizeMerchant.js";

let seq = 0;
const row = (date: string, amountCents: number, description: string, extra: Partial<NormalizedRow> = {}): NormalizedRow =>
  ({ rowIndex: seq++, date, amountCents, description, balanceCents: null, ...extra });

const bank: ClassifyAccount = { id: "acc-bank", type: "checking", currency: "EUR", cardDebtId: null };
const passCard: ClassifyAccount = { id: "acc-pass", type: "card", currency: "EUR", cardDebtId: "pass" };
const passDebt: ClassifyDebt = { id: "pass", name: "PASS", kind: "credit_card", accountId: "acc-pass" };

// ── A tiny in-memory pool: import files through classify → writes, then
//    count the month's spending exactly as every route does. ─────────────────

// The PASS case (plan §1.7 / epic 3 case 6): card paid in full each month,
// 300 € owed before October (the anchor).
const PASS_LEDGER_DEBT: LedgerDebt & { balanceAsOf: Date } = {
  id: "pass", kind: "credit_card", status: "active", paymentMode: "full", accountId: "acc-pass",
  currentBalance: 30000, installmentsPaid: 0, installmentsTotal: null, installmentAmount: null, minimumPayment: null,
  balanceAsOf: new Date(Date.UTC(2026, 8, 30, 12)),
};
const LINES = [{ id: "line-pass", debtId: "pass", debtAccountId: "acc-pass" }];
const SUPER = "line-super";

type Resolution = "payment" | "refund";

class Pool {
  constructor(private anchorCents = 30000) {}
  expenses: (LedgerExpense & { externalId: string; allocationId: string | null; description: string })[] = [];
  incomes: { id: string; externalId: string; amount: number; date: Date; accountId: string | null; description: string }[] = [];

  existing(): ExistingMovement[] {
    return [
      ...this.expenses.map(e => ({
        id: e.id, table: "expense" as const, externalId: e.externalId, accountId: e.accountId, debtId: e.debtId,
        kind: e.kind, amountCents: e.amount, date: e.date.toISOString().slice(0, 10), description: e.description, source: "import",
      })),
      ...this.incomes.map(i => ({
        id: i.id, table: "income" as const, externalId: i.externalId, accountId: i.accountId, debtId: null,
        kind: "income", amountCents: i.amount, date: i.date.toISOString().slice(0, 10), description: i.description, source: "import",
      })),
    ];
  }

  /** Preview + confirm what the UI preselects: every new row except possible
   *  duplicates, and review rows only once `resolve` answers for them. */
  import(rows: NormalizedRow[], account: ClassifyAccount, opts: {
    purchasesSign?: "negative" | "positive";
    resolve?: (p: PlannedRow) => Resolution | undefined;
    keepPossibleDuplicates?: boolean;
  } = {}) {
    const { resolve, keepPossibleDuplicates, ...classifyOpts } = opts;
    const result = classifyRows({ rows, account, debts: [passDebt], existing: this.existing(), ...classifyOpts });
    const kept = result.rows
      .filter(p => p.status === "new" && (keepPossibleDuplicates || !p.possibleDuplicate))
      .map(p => ({ p, kind: p.kind === "needs_review" ? resolve?.(p) : p.kind }))
      .filter((x): x is { p: PlannedRow; kind: Exclude<PlannedRow["kind"], "needs_review"> } => !!x.kind);
    const confirm: ConfirmRow[] = kept.map(({ p, kind }) => ({
      kind, externalId: p.externalId, date: p.date, description: p.description, merchant: p.merchant,
      amountCents: p.amountCents, debtId: kind === "payment" ? p.debtId : null, allocationId: kind === "expense" || kind === "refund" ? SUPER : null,
    }));
    const plan = planImportWrites(confirm, { accountId: account.id, debtLines: LINES, debts: [{ id: "pass", accountId: "acc-pass" }] });
    if ("error" in plan) throw new Error(plan.error);
    for (const e of plan.expenses) {
      if (this.expenses.some(x => x.externalId === e.externalId)) continue; // @@unique + skipDuplicates
      this.expenses.push({ ...e, id: `exp${this.expenses.length}`, createdAt: new Date() });
    }
    for (const i of plan.incomes) this.incomes.push({ ...i, id: `inc${this.incomes.length}` });
    return result;
  }

  /** Month spending: Σ counted ?? amount, as dashboard/analytics/monthlyBudgets. */
  spend(from: Date, to: Date, allocationId?: string): number {
    const ledgers = buildLedgers([this.debt()], this.expenses, []);
    const counted = countedFrom(ledgers, this.expenses.filter(e => e.kind === "refund"));
    return this.expenses
      .filter(e => e.date >= from && e.date < to && (!allocationId || e.allocationId === allocationId))
      .reduce((s, e) => s + (counted.get(e.id) ?? e.amount), 0);
  }

  debt() { return { ...PASS_LEDGER_DEBT, currentBalance: this.anchorCents }; }

  passBalance(): number {
    return debtState(buildLedgers([this.debt()], this.expenses, [])[0]).balance;
  }
}

const OCT: [Date, Date] = [new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 10, 1))];
const cardFile = (withPayment: boolean) => [
  row("2026-10-10", -5000, "SUPERMERCADO DEMO"),
  ...(withPayment ? [row("2026-10-25", 35000, "PAGO RECIBIDO GRACIAS")] : []),
];
const bankFile = () => [row("2026-10-23", -35000, "LIQUIDACION TARJETA PASS"), row("2026-10-01", 180000, "NOMINA")];

test("MONEY: card purchase 50 + card payment 350 from the bank → month spend 350, not 400", () => {
  const pool = new Pool();
  pool.import(cardFile(false), passCard);
  const bankResult = pool.import(bankFile(), bank);
  assert.equal(bankResult.rows[0].kind, "payment");
  assert.equal(bankResult.rows[0].debtId, "pass");
  assert.equal(pool.spend(...OCT), 35000);
  assert.equal(pool.spend(...OCT, SUPER), 5000);
  assert.equal(pool.passBalance(), 0);
  assert.equal(pool.incomes.length, 1); // the salary; the card payment is never income
});

test("MONEY: the payment arrives through BOTH files (bank first) → still 350", () => {
  const pool = new Pool();
  pool.import(bankFile(), bank);
  const card = pool.import(cardFile(true), passCard);
  const payment = card.rows.find(p => p.signedCents === 35000)!;
  assert.equal(payment.kind, "payment");
  assert.equal(payment.status, "duplicate");
  assert.equal(payment.duplicateReason, "same_payment");
  assert.equal(pool.spend(...OCT), 35000);
  assert.equal(pool.passBalance(), 0);
  assert.equal(pool.incomes.length, 1);
});

test("MONEY: the payment arrives through BOTH files (card first) → still 350", () => {
  const pool = new Pool();
  const card = pool.import(cardFile(true), passCard);
  assert.equal(card.rows.find(p => p.signedCents === 35000)!.kind, "payment");
  // Recorded from the card statement: who paid isn't known, never the card itself.
  assert.equal(pool.expenses.find(e => e.debtId === "pass")!.accountId, null);
  const bankResult = pool.import(bankFile(), bank);
  assert.equal(bankResult.rows[0].status, "duplicate");
  assert.equal(bankResult.rows[0].duplicateReason, "same_payment");
  assert.equal(pool.spend(...OCT), 35000);
  assert.equal(pool.passBalance(), 0);
});

test("MONEY: re-importing both files adds nothing", () => {
  const pool = new Pool();
  pool.import(cardFile(true), passCard);
  pool.import(bankFile(), bank);
  const before = pool.expenses.length + pool.incomes.length;
  const a = pool.import(cardFile(true), passCard);
  const b = pool.import(bankFile(), bank);
  assert.equal([...a.rows, ...b.rows].filter(p => p.status === "new").length, 0);
  assert.equal(pool.expenses.length + pool.incomes.length, before);
  assert.equal(pool.spend(...OCT), 35000);
});

test("MONEY: a card refund lowers the category's spending and the card debt", () => {
  const pool = new Pool();
  const r = pool.import([
    row("2026-10-10", -5000, "TIENDA ROPA DEMO"),
    row("2026-10-14", 2000, "DEVOLUCION TIENDA ROPA DEMO"),
  ], passCard);
  assert.deepEqual(r.rows.map(p => p.kind), ["expense", "refund"]);
  assert.equal(pool.expenses[1].kind, "refund");
  assert.equal(pool.expenses[1].amount, 2000); // stored positive…
  assert.equal(pool.spend(...OCT, SUPER), 3000); // …counted negative
  assert.equal(pool.passBalance(), 30000 + 3000);
  // Paying the whole card (330) afterwards: 300 is budget spending (pre-existing debt).
  pool.import([row("2026-10-25", -33000, "LIQUIDACION TARJETA")], bank);
  assert.equal(pool.passBalance(), 0);
  assert.equal(pool.spend(...OCT), 33000);
});

test("card statements that write purchases as positive are turned to the holder's view", () => {
  const pool = new Pool();
  const r = pool.import([
    row("2026-10-03", 1200, "CAFETERIA DEMO"),
    row("2026-10-04", 5000, "SUPERMERCADO DEMO"),
    row("2026-10-05", 2500, "FARMACIA DEMO"),
    row("2026-10-06", 900, "COMPRA EN KIOSCO DEMO"),
    row("2026-10-20", -35000, "PAGO RECIBIDO"),
  ], passCard);
  assert.equal(r.purchasesSign, "positive");
  assert.equal(r.purchasesSignDetected, true);
  assert.deepEqual(r.rows.map(p => [p.kind, p.signedCents]), [
    ["expense", -1200], ["expense", -5000], ["expense", -2500], ["expense", -900], ["payment", 35000],
  ]);
  // Stated by the user (saved mapping / preview toggle): not guessed.
  const stated = classifyRows({ rows: [row("2026-10-03", -1200, "X")], account: passCard, debts: [passDebt], existing: [], purchasesSign: "negative" });
  assert.equal(stated.purchasesSignDetected, false);
  assert.equal(stated.rows[0].kind, "expense");
});

test("sign: not guessed from a month of only payments, a single payment, or payments + interest", () => {
  const guess = (rows: NormalizedRow[]) => classifyRows({ rows, account: passCard, debts: [passDebt], existing: [] }).purchasesSign;
  // Reviewer repro (exp1 A): the bulk is payments, not purchases.
  assert.equal(guess([
    row("2026-10-01", 20000, "TRANSFERENCIA A TARJETA"),
    row("2026-10-15", 20000, "TRANSFERENCIA A TARJETA"),
    row("2026-10-20", -1500, "INTERESES"),
  ]), "unknown");
  assert.equal(guess([row("2026-10-01", 20000, "PAGO RECIBIDO")]), "unknown");
  // Payments + interest with enough anchored lines: the anchors, not the
  // (payment) bulk, decide — right in both conventions.
  const paymentsAndInterest = (s: 1 | -1) => [
    row("2026-10-01", s * 20000, "PAGO RECIBIDO"), row("2026-10-08", s * 20000, "TRASPASO"), row("2026-10-15", s * 20000, "TRASPASO"),
    row("2026-10-20", -s * 1500, "INTERESES"), row("2026-10-21", -s * 300, "COMISION"),
  ];
  assert.equal(guess(paymentsAndInterest(1)), "negative");
  assert.equal(guess(paymentsAndInterest(-1)), "positive");
  // …but with a single anchor the payment bulk would outvote it: ask.
  assert.equal(guess([
    row("2026-10-01", 20000, "TRASPASO"), row("2026-10-08", 20000, "TRASPASO"), row("2026-10-15", 20000, "TRASPASO"),
    row("2026-10-18", 20000, "TRASPASO"), row("2026-10-20", -1500, "INTERESES"),
  ]), "unknown");
  // Payments the words vouch for are enough, however few purchases.
  assert.equal(guess(Array.from({ length: 5 }, (_, i) => row(`2026-10-0${i + 1}`, 10000, "PAGO RECIBIDO GRACIAS"))), "negative");
  // Anchors that contradict each other: ask.
  assert.equal(guess([
    ...Array.from({ length: 6 }, (_, i) => row(`2026-10-0${i + 1}`, -1000, "TIENDA DEMO")),
    row("2026-10-10", 5000, "PAGO RECIBIDO"), row("2026-10-11", 5000, "COMPRA EN DEMO"),
  ]), "unknown");
  // A close vote: ask.
  assert.equal(guess([
    row("2026-10-01", -1000, "A"), row("2026-10-02", -1000, "B"), row("2026-10-03", -1000, "C"),
    row("2026-10-04", 1000, "D"), row("2026-10-05", 1000, "E"),
  ]), "unknown");
  // A plain holder's-view statement: guessed.
  assert.equal(guess([
    ...Array.from({ length: 8 }, (_, i) => row(`2026-10-0${i + 1}`, -1000 - i, `TIENDA ${i}`)),
    row("2026-10-20", 8000, "PAGO RECIBIDO"),
  ]), "negative");
});

// ── Decisions ──────────────────────────────────────────────────────────────

test("bank account: debit → expense, credit → income; 'pago con tarjeta' is NOT a card payment", () => {
  const r = classifyRows({
    rows: [row("2026-10-02", -4237, "Supermercado", { details: "Pago con tarjeta" }), row("2026-10-01", 180000, "Nómina")],
    account: bank, debts: [passDebt], existing: [],
  });
  assert.deepEqual(r.rows.map(p => [p.kind, p.debtId]), [["expense", null], ["income", null]]);
  assert.equal(r.mode, "account");
});

test("bank card payment: several cards → by name; none matches → expense flagged for review", () => {
  const visa: ClassifyDebt = { id: "visa", name: "Visa Oro", kind: "credit_card", accountId: "acc-visa" };
  const debts = [passDebt, visa];
  const byName = classifyRows({ rows: [row("2026-10-05", -10000, "RECIBO VISA ORO 1234")], account: bank, debts, existing: [] });
  assert.deepEqual([byName.rows[0].kind, byName.rows[0].debtId], ["payment", "visa"]);
  const unknown = classifyRows({ rows: [row("2026-10-05", -10000, "LIQUIDACION TARJETA")], account: bank, debts, existing: [] });
  assert.deepEqual([unknown.rows[0].kind, unknown.rows[0].warnings], ["expense", ["card_payment_unassigned"]]);
  // A loan or a card not tied to an account is never auto-detected.
  const loanOnly = classifyRows({
    rows: [row("2026-10-05", -10000, "PAGO TARJETA")], account: bank,
    debts: [{ id: "loan", name: "Préstamo", kind: "installment", accountId: null }], existing: [],
  });
  assert.equal(loanOnly.rows[0].kind, "expense");
});

test("rules the user taught (merchant → debt line) only PROPOSE a payment; a phrase naming a card decides", () => {
  const r = classifyRows({
    rows: [row("2026-10-05", -6000, "CETELEM RECIBO")], account: bank, debts: [], existing: [],
    learnedPayments: new Map([[seq - 1, { debtId: "cetelem", preselect: false }]]),
  });
  assert.deepEqual([r.rows[0].kind, r.rows[0].debtId, r.rows[0].learnedPayment, r.rows[0].warnings],
    ["payment", "cetelem", { preselect: false }, ["learned_payment"]]);
  const phrase = classifyRows({
    rows: [row("2026-10-05", -6000, "LIQUIDACION TARJETA")], account: bank, debts: [passDebt], existing: [],
    learnedPayments: new Map([[seq - 1, { debtId: "cetelem", preselect: true }]]),
  });
  assert.deepEqual([phrase.rows[0].debtId, phrase.rows[0].learnedPayment], ["pass", undefined]);
});

// ── Learned debt-line rules (learnedPayments.ts) ──────────────────────────

const LOAN: LearnedDebt = { id: "loan", accountId: null, installmentAmount: 25000, minimumPayment: null };
const loanRule = (_: { description: string; merchant: string }) => "line-loan";
const suggest = (rows: NormalizedRow[]) => suggestLearnedPayments(
  rows.map(r => ({ rowIndex: r.rowIndex, description: r.description, merchant: normalizeMerchant(r.description), amountCents: Math.abs(r.amountCents) })),
  { accountId: "acc-bank", ruleFor: loanRule, debtByLine: new Map([["line-loan", "loan"]]), debts: new Map([["loan", LOAN]]) },
);

test("generic merchants: transfers, Bizum, direct debits and very short keys are never debt-specific", () => {
  for (const m of ["Transferencia realizada", "TRASPASO", "Bizum", "Recibo", "PAGO", "Cargo", "Abono", "Ingreso",
    "Transfer to", "Payment", "SEPA direct debit", "ab", "Transferencia 1234"]) {
    assert.equal(isGenericMerchant(m), true, m);
  }
  for (const m of ["Cetelem", "Wizink", "Klarna", "Mercadona", "Alquiler Juan Perez"]) assert.equal(isGenericMerchant(m), false, m);
});

test("MONEY: a rent 'Transferencia realizada' of 750 never lowers a loan, even with a learned rule", () => {
  const rent = row("2026-10-01", -75000, "Transferencia realizada");
  assert.equal(suggest([rent]).size, 0);
  const r = classifyRows({ rows: [rent], account: bank, debts: [], existing: [], learnedPayments: suggest([rent]) });
  assert.deepEqual([r.rows[0].kind, r.rows[0].debtId], ["expense", null]);
  const plan = planImportWrites(
    r.rows.map(p => ({ kind: p.kind as ConfirmRow["kind"], externalId: p.externalId, date: p.date, amountCents: p.amountCents, debtId: p.debtId })),
    { accountId: "acc-bank", debtLines: [{ id: "line-loan", debtId: "loan", debtAccountId: null }], debts: [{ id: "loan", accountId: null }] },
  );
  assert.ok(!("error" in plan) && plan.expenses.every(e => e.debtId === null));
});

test("learned payment of a specific merchant: preselected only at the instalment amount (±1 €)", () => {
  const exact = row("2026-10-05", -25050, "CETELEM PRESTAMO");
  const off = row("2026-10-05", -40000, "CETELEM PRESTAMO");
  const s = suggest([exact, off]);
  assert.deepEqual(s.get(exact.rowIndex), { debtId: "loan", preselect: true });
  assert.deepEqual(s.get(off.rowIndex), { debtId: "loan", preselect: false });
  assert.equal(preselectLearnedPayment(25101, LOAN), false);
  assert.equal(preselectLearnedPayment(25000, { ...LOAN, installmentAmount: null }), false);
  // A card never pays itself through a rule.
  const own = suggestLearnedPayments([{ rowIndex: 0, description: "PASS", merchant: "pass carrefour", amountCents: 100 }], {
    accountId: "acc-pass", ruleFor: () => "line-pass", debtByLine: new Map([["line-pass", "pass"]]),
    debts: new Map([["pass", { id: "pass", accountId: "acc-pass", installmentAmount: null, minimumPayment: null }]]),
  });
  assert.equal(own.size, 0);
});

test("card: an unlabelled credit needs review (never guessed); refund wins over payment words", () => {
  const r = classifyRows({
    rows: [row("2026-10-05", 1500, "ABONO"), row("2026-10-06", 900, "DEVOLUCION PAGO")],
    account: passCard, debts: [passDebt], existing: [], purchasesSign: "negative",
  });
  assert.deepEqual(r.rows.map(p => [p.kind, p.debtId, p.warnings]), [
    ["needs_review", "pass", ["ambiguous_credit"]],
    ["refund", null, []],
  ]);
  // A review row is never writable as such: the user must pick a side.
  const plan = planImportWrites([{ kind: "needs_review", externalId: "x", date: "2026-10-05", amountCents: 1500 }],
    { accountId: "acc-pass", debtLines: LINES, debts: [{ id: "pass", accountId: "acc-pass" }] });
  assert.ok("error" in plan);
});

// Reviewer repro (exp1 B): a card payment with a label no phrase knows.
const reproCardFile = () => [
  row("2026-10-03", -5000, "SUPER DEMO"),
  row("2026-10-05", -3000, "GASOLINERA DEMO"),
  row("2026-10-06", 60000, "TRASPASO CUENTA"),
];
const reproBankFile = () => [row("2026-10-06", -60000, "LIQUIDACION TARJETA VISA")];

test("MONEY: an unlabelled card credit resolved as payment + the bank's charge → debt 80, never -520", () => {
  const pool = new Pool(60000);
  const card = pool.import(reproCardFile(), passCard, { purchasesSign: "negative" });
  const review = card.rows.find(p => p.signedCents === 60000)!;
  assert.equal(review.kind, "needs_review");
  // Unresolved, nothing about the credit is written.
  assert.equal(pool.expenses.length, 2);
  assert.equal(pool.passBalance(), 68000);
  // The user resolves it as a payment (a re-preview: the purchases are duplicates now).
  pool.import(reproCardFile(), passCard, { purchasesSign: "negative", resolve: () => "payment" });
  assert.equal(pool.passBalance(), 8000);
  const fromBank = pool.import(reproBankFile(), bank);
  assert.deepEqual([fromBank.rows[0].kind, fromBank.rows[0].status, fromBank.rows[0].duplicateReason], ["payment", "duplicate", "same_payment"]);
  assert.equal(pool.passBalance(), 8000);
});

test("MONEY: the same credit wrongly resolved as refund → the bank payment is flagged, not silently added", () => {
  const pool = new Pool(60000);
  pool.import(reproCardFile(), passCard, { purchasesSign: "negative", resolve: () => "refund" });
  const fromBank = pool.import(reproBankFile(), bank);
  assert.equal(fromBank.rows[0].kind, "payment");
  assert.equal(fromBank.rows[0].status, "new");
  assert.equal(fromBank.rows[0].possibleDuplicate?.id, pool.expenses.find(e => e.kind === "refund")!.id);
  // Not preselected: the debt isn't lowered a second time unless the user says so.
  assert.equal(pool.passBalance(), 60000 + 8000 - 60000);
});

test("card: a credit equal to a stored payment of this card is that payment, even unlabelled", () => {
  const stored: ExistingMovement = {
    id: "p1", table: "expense", externalId: "manual", accountId: "acc-bank", debtId: "pass", kind: "expense",
    amountCents: 35000, date: "2026-10-23", description: "Pagar tarjeta", source: "manual",
  };
  const r = classifyRows({ rows: [row("2026-10-26", 35000, "ABONO")], account: passCard, debts: [passDebt], existing: [stored], purchasesSign: "negative" });
  assert.deepEqual([r.rows[0].kind, r.rows[0].status, r.rows[0].duplicateReason], ["payment", "duplicate", "same_payment"]);
});

// ── Dedup ──────────────────────────────────────────────────────────────────

test("fingerprint includes the account: the same line in two accounts is two movements", () => {
  const line = () => [row("2026-10-05", -1000, "CAFE")];
  const a = classifyRows({ rows: line(), account: bank, debts: [], existing: [] }).rows[0];
  const b = classifyRows({ rows: line(), account: { ...bank, id: "acc-other" }, debts: [], existing: [] }).rows[0];
  assert.notEqual(a.externalId, b.externalId);
  assert.equal(a.legacyExternalId, b.legacyExternalId); // the old id didn't know the account
});

test("no balance column: identical lines the same day are told apart by occurrence, and match one to one", () => {
  const day = (n: number) => Array.from({ length: n }, () => row("2026-10-05", -380, "CAFETERIA"));
  const two = classifyRows({ rows: day(2), account: passCard, debts: [passDebt], existing: [], purchasesSign: "negative" }).rows;
  assert.equal(new Set(two.map(p => p.externalId)).size, 2);
  // A later export of the same day has a third coffee: only that one is new.
  const existing = two.map((p, i) => ({
    id: `c${i}`, table: "expense" as const, externalId: p.externalId, accountId: "acc-pass", debtId: null, kind: "expense",
    amountCents: 380, date: "2026-10-05", description: "CAFETERIA", source: "import",
  }));
  const three = classifyRows({ rows: day(3), account: passCard, debts: [passDebt], existing, purchasesSign: "negative" }).rows;
  assert.deepEqual(three.map(p => p.status), ["duplicate", "duplicate", "new"]);
  // …and the stored ones aren't offered as "possible duplicates" of the new one.
  assert.equal(three[2].possibleDuplicate, undefined);
});

test("the source's own id (OFX FITID) is the fingerprint when there is one", () => {
  const a = classifyRows({ rows: [row("2026-10-05", -1000, "CAFE", { externalRef: "F1" })], account: bank, debts: [], existing: [] }).rows[0];
  const b = classifyRows({ rows: [row("2026-10-06", -1000, "CAFE corrected", { externalRef: "F1" })], account: bank, debts: [], existing: [] }).rows[0];
  assert.equal(a.externalId, b.externalId);
});

test("possible duplicate across sources: flagged, not dropped; another account doesn't count", () => {
  const manual: ExistingMovement = {
    id: "m1", table: "expense", externalId: null, accountId: "acc-bank", debtId: null, kind: "expense",
    amountCents: 2599, date: "2026-10-04", description: "Cena", source: "manual",
  };
  const elsewhere: ExistingMovement = { ...manual, id: "m2", accountId: "acc-other" };
  const r = classifyRows({ rows: [row("2026-10-05", -2599, "RESTAURANTE DEMO")], account: bank, debts: [], existing: [elsewhere, manual] }).rows[0];
  assert.equal(r.status, "new");
  assert.deepEqual(r.possibleDuplicate, { id: "m1", table: "expense", date: "2026-10-04", description: "Cena", source: "manual" });
  const far = classifyRows({ rows: [row("2026-10-09", -2599, "RESTAURANTE DEMO")], account: bank, debts: [], existing: [manual] }).rows[0];
  assert.equal(far.possibleDuplicate, undefined);
});

test("zero-amount lines are dropped; fees become their own expense; currency mismatch is flagged", () => {
  const r = classifyRows({
    rows: [row("2026-10-05", 0, "INFO"), row("2026-10-05", -6000, "ATM", { feeCents: -120, currency: "USD" })],
    account: bank, debts: [], existing: [],
  }).rows;
  assert.deepEqual(r.map(p => [p.kind, p.amountCents, p.isFee, p.warnings]), [
    ["expense", 6000, false, ["currency_mismatch"]],
    ["expense", 120, true, ["currency_mismatch"]],
  ]);
  assert.notEqual(r[0].externalId, r[1].externalId);
});

// ── Writes ─────────────────────────────────────────────────────────────────

test("writes: a card can't pay itself; refunds never on a debt line; payments need a known debt", () => {
  const ctx = { accountId: "acc-pass", debtLines: LINES, debts: [{ id: "pass", accountId: "acc-pass" }] };
  const base = { externalId: "x", date: "2026-10-05", amountCents: 100 };
  const paid = planImportWrites([{ ...base, kind: "expense", allocationId: "line-pass" }], ctx);
  assert.ok("error" in paid && paid.code === "paid_from_card");
  assert.ok("error" in planImportWrites([{ ...base, kind: "refund", allocationId: "line-pass" }], ctx));
  assert.ok("error" in planImportWrites([{ ...base, kind: "payment", debtId: "someone-elses" }], ctx));
  assert.ok("error" in planImportWrites([{ ...base, kind: "transfer" }], ctx));
  assert.ok("error" in planImportWrites([{ ...base, kind: "expense", amountCents: 1.5 }], ctx));
  // From a bank account, an expense on the card's line is a payment of it.
  const fromBank = planImportWrites([{ ...base, kind: "expense", allocationId: "line-pass" }], { ...ctx, accountId: "acc-bank" });
  assert.ok(!("error" in fromBank) && fromBank.expenses[0].debtId === "pass");
});

test("debt lines: a refund never pays a debt, a card never pays itself (PATCH/POST share this)", () => {
  assert.equal(debtLineError("refund", { accountId: null }, "acc-bank")?.code, "refund_on_debt_line");
  assert.equal(debtLineError("expense", { accountId: "acc-pass" }, "acc-pass")?.code, "paid_from_card");
  assert.equal(debtLineError("expense", { accountId: "acc-pass" }, "acc-bank"), null);
  assert.equal(debtLineError("refund", null, "acc-bank"), null); // not a debt line: fine
});

test("card payment 5–10 days from a stored payment of the same card: flagged, not merged nor silently added", () => {
  const stored: ExistingMovement = {
    id: "p1", table: "expense", externalId: "card-file", accountId: null, debtId: "pass", kind: "expense",
    amountCents: 35000, date: "2026-10-30", description: "PAGO RECIBIDO", source: "import",
  };
  const near = classifyRows({ rows: [row("2026-10-27", -35000, "LIQUIDACION TARJETA")], account: bank, debts: [passDebt], existing: [stored] }).rows[0];
  assert.equal(near.status, "duplicate"); // ≤ 4 days: the same payment
  const late = classifyRows({ rows: [row("2026-10-22", -35000, "LIQUIDACION TARJETA")], account: bank, debts: [passDebt], existing: [stored] }).rows[0];
  assert.deepEqual([late.kind, late.status, late.possibleDuplicate?.id], ["payment", "new", "p1"]);
  const far = classifyRows({ rows: [row("2026-10-15", -35000, "LIQUIDACION TARJETA")], account: bank, debts: [passDebt], existing: [stored] }).rows[0];
  assert.deepEqual([far.status, far.possibleDuplicate], ["new", undefined]);
});

test("unassigned card payment (several cards): flagged with the stored payment it may repeat", () => {
  const visa: ClassifyDebt = { id: "visa", name: "Visa Oro", kind: "credit_card", accountId: "acc-visa" };
  const stored: ExistingMovement = {
    id: "v1", table: "expense", externalId: null, accountId: null, debtId: "visa", kind: "expense",
    amountCents: 12000, date: "2026-10-12", description: "PAGO RECIBIDO", source: "import",
  };
  const r = classifyRows({ rows: [row("2026-10-05", -12000, "LIQUIDACION TARJETA")], account: bank, debts: [passDebt, visa], existing: [stored] }).rows[0];
  assert.deepEqual([r.kind, r.warnings, r.possibleDuplicate?.id], ["expense", ["card_payment_unassigned"], "v1"]);
});
