import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autoWritable, externalRefFor, heldForReview, owedFromCardBalance, reviewDateFrom, syncDateFrom, syncErrorCode,
  toConfirmRow, toNormalizedRows,
} from "./sync.js";
import { EnableBankingError } from "./enableBanking.js";
import { classifyRows, type ClassifyAccount, type ClassifyDebt, type ExistingMovement } from "../ingest/classify.js";
import type { ImportRow } from "../importStatement.js";
import type { BankProviderTxn } from "./types.js";

const BANK: ClassifyAccount = { id: "acc-bbva", type: "checking", currency: "EUR", cardDebtId: null };
const CARD: ClassifyAccount = { id: "acc-card", type: "card", currency: "EUR", cardDebtId: "debt-card" };
const DEBTS: ClassifyDebt[] = [{ id: "debt-card", name: "Aqua", kind: "credit_card", accountId: "acc-card" }];

const txn = (over: Partial<BankProviderTxn>): BankProviderTxn =>
  ({ id: "tx-1", date: "2026-10-20", description: "MERCADONA", amountCents: -4550, currency: "EUR", ...over });

test("provider ids are namespaced: enablebanking:<id>", () => {
  assert.equal(externalRefFor("abc"), "enablebanking:abc");
  const rows = toNormalizedRows([txn({ id: "abc" }), txn({ id: null })]);
  assert.equal(rows[0].externalRef, "enablebanking:abc");
  assert.equal(rows[1].externalRef, null); // content fingerprint instead
});

test("toNormalizedRows keeps the holder's view sign, day, details and running balance", () => {
  const [row] = toNormalizedRows([txn({ details: "COMPRA TARJ", balanceAfterCents: 98800 })]);
  assert.deepEqual(row, {
    rowIndex: 0, date: "2026-10-20", amountCents: -4550, description: "MERCADONA", details: "COMPRA TARJ",
    balanceCents: 98800, externalRef: "enablebanking:tx-1", currency: "EUR",
  });
});

test("the same provider movement synced twice is the same movement (stable externalId)", () => {
  const first = classifyRows({ rows: toNormalizedRows([txn({})]), account: BANK, debts: [], existing: [] });
  const stored: ExistingMovement = {
    id: "e1", table: "expense", externalId: first.rows[0].externalId, accountId: BANK.id, debtId: null,
    kind: "expense", amountCents: 4550, date: "2026-10-20", description: "MERCADONA", source: "bank_sync",
  };
  // A later sync re-reads it in another order, next to a new one.
  const again = classifyRows({ rows: toNormalizedRows([txn({ id: "tx-2", date: "2026-10-21" }), txn({})]), account: BANK, debts: [], existing: [stored] });
  assert.equal(again.rows.find(r => r.date === "2026-10-20")!.status, "duplicate");
  assert.equal(again.rows.find(r => r.date === "2026-10-21")!.status, "new");
});

test("a movement without provider id gets the same content fingerprint on every sync", () => {
  const a = classifyRows({ rows: toNormalizedRows([txn({ id: null, balanceAfterCents: 1000 })]), account: BANK, debts: [], existing: [] });
  const b = classifyRows({ rows: toNormalizedRows([txn({ id: "other", date: "2026-10-01" }), txn({ id: null, balanceAfterCents: 1000 })]), account: BANK, debts: [], existing: [] });
  assert.equal(a.rows[0].externalId, b.rows[1].externalId);
});

test("a bank movement already imported from a file is flagged, never written twice", () => {
  const fileImported: ExistingMovement = {
    id: "e-file", table: "expense", externalId: "0123456789abcdef0123456789abcdef", accountId: BANK.id, debtId: null,
    kind: "expense", amountCents: 4550, date: "2026-10-19", description: "MERCADONA SA", source: "import",
  };
  const res = classifyRows({ rows: toNormalizedRows([txn({})]), account: BANK, debts: [], existing: [fileImported] });
  assert.equal(res.rows[0].status, "new");
  assert.equal(res.rows[0].possibleDuplicate?.id, "e-file");
  // → the daily sync holds it for review.
  assert.equal(autoWritable(preview({ status: "new", kind: "expense", possibleDuplicate: { id: "e-file", table: "expense", date: "2026-10-19", description: "x", source: "import" } })), false);
});

test("card mode: a DBIT is a purchase, a recognised credit a payment, an unclear one waits for review", () => {
  const rows = toNormalizedRows([
    txn({ id: "p", amountCents: -2000, description: "AMAZON" }),
    txn({ id: "r", amountCents: 30000, description: "PAGO RECIBIDO GRACIAS" }),
    txn({ id: "x", amountCents: 1500, description: "ABONO VARIOS" }),
  ]);
  const res = classifyRows({ rows, account: CARD, debts: DEBTS, existing: [], purchasesSign: "negative" });
  assert.deepEqual(res.rows.map(r => r.kind), ["expense", "payment", "needs_review"]);
  assert.equal(res.rows[1].debtId, "debt-card");
});

const preview = (over: Partial<ImportRow>): ImportRow => ({
  externalId: "x", date: "2026-10-20", description: "MERCADONA", merchant: "mercadona", amount: 45.5, signedAmount: -45.5,
  kind: "expense", status: "new", suggestedAllocationId: null, suggestedAllocationName: null, warnings: [], ...over,
});

test("autoWritable: only new, clean rows of a sure kind", () => {
  assert.equal(autoWritable(preview({})), true);
  assert.equal(autoWritable(preview({ kind: "income" })), true);
  assert.equal(autoWritable(preview({ kind: "payment", debtId: "d" })), true);
  assert.equal(autoWritable(preview({ kind: "refund" })), true);
  assert.equal(autoWritable(preview({ status: "duplicate" })), false);
  assert.equal(autoWritable(preview({ kind: "needs_review" })), false);
  assert.equal(autoWritable(preview({ warnings: ["possible_card_payment"] })), false);
  assert.equal(autoWritable(preview({ warnings: ["currency_mismatch"] })), false);
  assert.equal(autoWritable(preview({ kind: "payment", learnedPayment: { preselect: true }, warnings: [] })), false);
  assert.equal(heldForReview([preview({}), preview({ kind: "needs_review" }), preview({ status: "duplicate", kind: "needs_review" })]), 1);
});

test("toConfirmRow: cents from euros, rule category for spending, the debt for a payment", () => {
  assert.deepEqual(toConfirmRow(preview({ amount: 45.5, suggestedAllocationId: "groceries" })), {
    kind: "expense", externalId: "x", date: "2026-10-20", description: "MERCADONA", merchant: "mercadona",
    amountCents: 4550, allocationId: "groceries", debtId: null,
  });
  const payment = toConfirmRow(preview({ kind: "payment", amount: 300, debtId: "debt-card", suggestedAllocationId: "debt-line" }));
  assert.equal(payment.amountCents, 30000);
  assert.equal(payment.debtId, "debt-card");
  assert.equal(payment.allocationId, null); // the debt's line comes from the debt
  assert.equal(toConfirmRow(preview({ amount: 0.29 })).amountCents, 29);
});

test("sync windows: first review 90 days; later from the review day; daily a week back, never before the review", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  assert.equal(reviewDateFrom({ bankReviewedAt: null }, now), "2026-07-31");
  assert.equal(reviewDateFrom({ bankReviewedAt: new Date("2026-10-20T08:00:00Z") }, now), "2026-10-20");
  const reviewed = { bankReviewedAt: new Date("2026-10-01T08:00:00Z") };
  assert.equal(syncDateFrom(reviewed, new Date("2026-10-28T05:00:00Z")), "2026-10-21");
  assert.equal(syncDateFrom(reviewed, new Date("2026-10-03T05:00:00Z")), "2026-10-01");
  assert.equal(syncDateFrom(reviewed, null), "2026-10-01");
});

test("a card's owed amount is the magnitude of its balance", () => {
  assert.equal(owedFromCardBalance(-48020), 48020);
  assert.equal(owedFromCardBalance(48020), 48020);
});

test("lastSyncError is a code, never the provider's text", () => {
  assert.equal(syncErrorCode(new EnableBankingError(422, "GET /accounts/{uid}/transactions", "ASPSP_ERROR")), "provider_422_ASPSP_ERROR");
  assert.equal(syncErrorCode(new Error("ES9121000418450200051332 something")), "failed");
});
