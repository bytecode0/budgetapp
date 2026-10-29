// The ingest core: what each movement IS, and whether it's already recorded.
// One function for every source — a file today (epic 4), a bank feed in epic 5
// — so an imported movement and a synced one are treated the same.
// Pure (no DB): importStatement.ts loads the context and writes the result.
//
// Decisions (docs/plan-deudas-y-onboarding.md §4.1, and CLAUDE.md "How debts work"):
//
//  Bank account (mode "account"):
//    money out → expense in its category;
//    money out that is a card payment ("LIQUIDACION TARJETA"…, §4.4) → payment
//      of that card's debt (Expense with debtId) — never an expense or income too;
//    money in → income.
//  Credit card (mode "card"; amounts first turned to the holder's view):
//    purchase → expense on the card account (raises the card debt through
//      debtBalance's purchases);
//    payment received → payment of the card's debt. If that payment was
//      already recorded (imported from the bank file, or by hand) it's the SAME
//      payment: marked duplicate, so it never counts twice;
//    refund → Expense kind "refund" on the card: lowers the debt and the
//      spending of its category (debtBalance / countedAmounts read it negative);
//    a credit that is neither recognisably → refund, flagged "ambiguous_credit".
//  A fee (Revolut) becomes its own expense row next to its movement.
//
// Dedup (§4.1):
//  - fingerprint per ACCOUNT: the same line in two accounts is two movements;
//  - the source's own id when it has one (OFX FITID); else date + amount +
//    merchant + running balance; with no balance, the occurrence number of
//    identical lines that day (two 3,80 € coffees are two coffees, and a
//    re-export of the same day still matches them one to one);
//  - ids from before this change (no account in the hash) still count, so
//    re-importing an old file doesn't duplicate it;
//  - a "possible duplicate" (same amount, ±2 days, same account, other source)
//    is only flagged for the user to decide, never dropped.
import crypto from "crypto";
import { normalizeMerchant } from "../normalizeMerchant.js";
import type { NormalizedRow } from "./types.js";

export type ImportMode = "account" | "card";
export type PlannedKind = "expense" | "income" | "payment" | "refund";
export type RowWarning = "currency_mismatch" | "ambiguous_credit" | "card_payment_unassigned";

export interface ClassifyAccount {
  id: string | null;
  type: string;      // checking | savings | cash | investment | card
  currency: string;  // ISO 4217
  /** The debt behind a card account (server/lib/cardDebt.ts). */
  cardDebtId: string | null;
}

export interface ClassifyDebt {
  id: string;
  name: string;
  kind: string;
  accountId: string | null;
}

/** An Expense or Income already stored, as far as dedup needs it. */
export interface ExistingMovement {
  id: string;
  table: "expense" | "income";
  externalId: string | null;
  accountId: string | null;
  debtId: string | null;
  kind: string; // expense | refund (Expense) — "income" for Income
  amountCents: number; // positive, as stored
  date: string; // yyyy-mm-dd
  description: string;
  source: string;
}

export interface PossibleDuplicate {
  id: string;
  table: "expense" | "income";
  date: string;
  description: string;
  source: string;
}

export interface PlannedRow {
  rowIndex: number;
  date: string;
  description: string;
  details?: string;
  merchant: string;
  amountCents: number; // positive
  signedCents: number; // holder's view
  kind: PlannedKind;
  debtId: string | null;
  isFee: boolean;
  externalId: string;
  legacyExternalId: string | null;
  status: "new" | "duplicate";
  duplicateReason?: "same_movement" | "same_payment";
  possibleDuplicate?: PossibleDuplicate;
  warnings: RowWarning[];
}

export interface ClassifyInput {
  rows: NormalizedRow[];
  account: ClassifyAccount;
  debts: ClassifyDebt[];
  existing: ExistingMovement[];
  /** Card files: how purchases appear. Undefined → detected. */
  purchasesSign?: "negative" | "positive";
  /** Bank rows (by rowIndex) the user's categorisation rules already put on a
   *  debt's budget line: payments of that debt, as the user taught. */
  learnedPayments?: ReadonlyMap<number, string>;
}

export interface ClassifyResult {
  mode: ImportMode;
  rows: PlannedRow[];
  /** Card mode: the sign convention applied, and whether it was guessed. */
  purchasesSign?: "negative" | "positive";
  purchasesSignDetected?: boolean;
}

// Matching windows, in days.
const SAME_PAYMENT_DAYS = 4;    // a card payment shows on the card a few days after the bank charge
const POSSIBLE_DUP_DAYS = 2;

const textOf = (r: { description: string; details?: string }) =>
  ` ${normalizeText(`${r.description} ${r.details ?? ""}`)} `;

export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const hasPhrase = (text: string, phrases: string[]) => phrases.some(p => text.includes(` ${p} `));

// Bank side: the charge that pays a card. Specific phrases only — "pago con
// tarjeta" (a debit-card purchase) must NOT match.
const BANK_CARD_PAYMENT = [
  "liquidacion tarjeta", "liquidacion de tarjeta", "liquidacion de la tarjeta", "liq tarjeta",
  "pago tarjeta", "pago de tarjeta", "pago de la tarjeta", "recibo visa", "recibo mastercard",
  "recibo tarjeta", "cargo tarjeta credito", "credit card payment", "credit card repayment", "card repayment",
];
// Card side: the line that records a payment received.
const CARD_PAYMENT_RECEIVED = [
  "pago recibido", "su pago", "pago gracias", "abono pago", "abono de pago", "abono por pago",
  "pago tarjeta", "pago de tarjeta", "liquidacion", "recibo", "ingreso", "transferencia recibida",
  "payment received", "payment thank you", "thank you for your payment", "payment",
];
const CARD_REFUND = ["devolucion", "reembolso", "anulacion", "abono compra", "refund", "reversal", "chargeback"];

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const daysApart = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));
const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);

/** The id hashed before ids carried the account (importStatement.ts until
 *  stage 1 of epic 4): day | signed cents | merchant | balance in euros. */
export function legacyExternalId(date: string, signedCents: number, merchant: string, balanceCents: number | null | undefined): string {
  return hash([date, signedCents, merchant, balanceCents === null || balanceCents === undefined ? "" : String(balanceCents / 100)].join("|"));
}

/** The card debt a bank-side card-payment line pays, when it can be told. */
function detectCardPayment(row: NormalizedRow, account: ClassifyAccount, debts: ClassifyDebt[]): { debtId: string | null } | null {
  const text = textOf(row);
  if (!hasPhrase(text, BANK_CARD_PAYMENT)) return null;
  const cards = debts.filter(d => d.kind === "credit_card" && d.accountId && d.accountId !== account.id);
  if (cards.length === 1) return { debtId: cards[0].id };
  const named = cards.filter(d => {
    const n = normalizeText(d.name);
    return n.length >= 3 && text.includes(` ${n} `);
  });
  return { debtId: named.length === 1 ? named[0].id : null };
}

/** Purchases are the bulk of a card statement: if most lines are positive,
 *  the file writes purchases as positive. */
export function guessPurchasesSign(rows: NormalizedRow[]): "negative" | "positive" {
  let pos = 0, neg = 0;
  for (const r of rows) { if (r.amountCents > 0) pos++; else if (r.amountCents < 0) neg++; }
  return pos > neg ? "positive" : "negative";
}

export function classifyRows(input: ClassifyInput): ClassifyResult {
  const { account, debts, existing } = input;
  const mode: ImportMode = account.type === "card" ? "card" : "account";

  let rows = input.rows.filter(r => r.amountCents !== 0);
  let purchasesSign: "negative" | "positive" | undefined;
  let purchasesSignDetected: boolean | undefined;
  if (mode === "card") {
    purchasesSign = input.purchasesSign ?? guessPurchasesSign(rows);
    purchasesSignDetected = input.purchasesSign === undefined;
    if (purchasesSign === "positive") {
      rows = rows.map(r => ({ ...r, amountCents: -r.amountCents, feeCents: r.feeCents ? -Math.abs(r.feeCents) : r.feeCents }));
    }
  }

  // Existing movements by id: both id generations, so an old import is found.
  const existingIds = new Set(existing.map(e => e.externalId).filter((id): id is string => !!id));
  const accountKey = account.id ?? "none";
  const occurrences = new Map<string, number>();
  const planned: PlannedRow[] = [];

  for (const row of rows) {
    const merchant = normalizeMerchant(row.description);
    let key: string;
    if (row.externalRef) {
      key = `v2|${accountKey}|ref|${row.externalRef}`;
    } else if (row.balanceCents !== null && row.balanceCents !== undefined) {
      key = `v2|${accountKey}|${row.date}|${row.amountCents}|${merchant}|bal:${row.balanceCents}`;
    } else {
      const same = `${row.date}|${row.amountCents}|${merchant}`;
      const n = occurrences.get(same) ?? 0;
      occurrences.set(same, n + 1);
      key = `v2|${accountKey}|${same}|#${n}`;
    }

    const warnings: RowWarning[] = [];
    if (row.currency && account.currency && row.currency.toUpperCase() !== account.currency.toUpperCase()) {
      warnings.push("currency_mismatch");
    }

    let kind: PlannedKind;
    let debtId: string | null = null;
    if (mode === "account") {
      if (row.amountCents > 0) kind = "income";
      else {
        const learned = input.learnedPayments?.get(row.rowIndex);
        const payment = learned ? { debtId: learned } : detectCardPayment(row, account, debts);
        if (payment?.debtId) { kind = "payment"; debtId = payment.debtId; }
        else {
          kind = "expense";
          if (payment) warnings.push("card_payment_unassigned");
        }
      }
    } else if (row.amountCents < 0) {
      kind = "expense";
    } else {
      const text = textOf(row);
      const matchesStoredPayment = !!account.cardDebtId && existing.some(e =>
        e.table === "expense" && e.debtId === account.cardDebtId && e.amountCents === row.amountCents
        && daysApart(e.date, row.date) <= SAME_PAYMENT_DAYS);
      if (hasPhrase(text, CARD_REFUND)) kind = "refund";
      else if (account.cardDebtId && (matchesStoredPayment || hasPhrase(text, CARD_PAYMENT_RECEIVED))) {
        kind = "payment";
        debtId = account.cardDebtId;
      } else {
        kind = "refund";
        warnings.push("ambiguous_credit");
      }
    }

    const legacy = legacyExternalId(row.date, row.amountCents, merchant, row.balanceCents);
    planned.push({
      rowIndex: row.rowIndex,
      date: row.date,
      description: row.description,
      ...(row.details ? { details: row.details } : {}),
      merchant,
      amountCents: Math.abs(row.amountCents),
      signedCents: row.amountCents,
      kind,
      debtId,
      isFee: false,
      externalId: hash(key),
      legacyExternalId: legacy,
      status: existingIds.has(hash(key)) || existingIds.has(legacy) ? "duplicate" : "new",
      ...(existingIds.has(hash(key)) || existingIds.has(legacy) ? { duplicateReason: "same_movement" as const } : {}),
      warnings,
    });

    if (row.feeCents) {
      const feeId = hash(`${key}|fee`);
      planned.push({
        rowIndex: row.rowIndex,
        date: row.date,
        description: row.description,
        merchant,
        amountCents: Math.abs(row.feeCents),
        signedCents: -Math.abs(row.feeCents),
        kind: "expense",
        debtId: null,
        isFee: true,
        externalId: feeId,
        legacyExternalId: null,
        status: existingIds.has(feeId) ? "duplicate" : "new",
        ...(existingIds.has(feeId) ? { duplicateReason: "same_movement" as const } : {}),
        warnings: warnings.filter(w => w === "currency_mismatch"),
      });
    }
  }

  // Movements this batch already matched by id can't also be "the same
  // payment" or a "possible duplicate" of another row.
  const batchIds = new Set(planned.flatMap(p => [p.externalId, p.legacyExternalId].filter((id): id is string => !!id)));
  const claimed = new Set(existing.filter(e => e.externalId && batchIds.has(e.externalId)).map(e => e.id));
  const claim = (pred: (e: ExistingMovement) => boolean) => {
    const hit = existing
      .filter(e => !claimed.has(e.id) && pred(e))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0];
    if (hit) claimed.add(hit.id);
    return hit;
  };

  // The same card payment seen from the other side (bank file ↔ card file).
  for (const p of planned) {
    if (p.status !== "new" || p.kind !== "payment") continue;
    const same = claim(e => e.table === "expense" && e.debtId === p.debtId && e.amountCents === p.amountCents
      && daysApart(e.date, p.date) <= SAME_PAYMENT_DAYS);
    if (same) { p.status = "duplicate"; p.duplicateReason = "same_payment"; }
  }

  // Possible duplicates across sources: flagged, the user decides.
  for (const p of planned) {
    if (p.status !== "new" || p.isFee) continue;
    const table = p.kind === "income" ? "income" : "expense";
    const storedKind = p.kind === "refund" ? "refund" : p.kind === "income" ? "income" : "expense";
    const hit = claim(e => e.table === table && (e.kind || "expense") === storedKind
      && e.amountCents === p.amountCents && daysApart(e.date, p.date) <= POSSIBLE_DUP_DAYS
      && (p.kind === "payment"
        ? e.debtId === p.debtId
        : e.debtId === null && (e.accountId === account.id || e.accountId === null)));
    if (hit) p.possibleDuplicate = { id: hit.id, table: hit.table, date: hit.date, description: hit.description, source: hit.source };
  }

  return { mode, rows: planned, purchasesSign, purchasesSignDetected };
}
