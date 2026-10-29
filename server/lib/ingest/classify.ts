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
//    a credit that is neither recognisably (and matches no stored payment) →
//      "needs_review", flagged "ambiguous_credit": never guessed, because a
//      payment taken for a refund (or the reverse) moves the debt by twice
//      the amount. The user picks payment or refund in the preview.
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
import type { LearnedPayment } from "./learnedPayments.js";
import type { NormalizedRow } from "./types.js";

export type ImportMode = "account" | "card";
/** "needs_review": a card credit that is neither recognisably a payment nor a
 *  refund. Never written as such: the user resolves it to one or the other. */
export type PlannedKind = "expense" | "income" | "payment" | "refund" | "needs_review";
export type RowWarning = "currency_mismatch" | "ambiguous_credit" | "card_payment_unassigned" | "learned_payment";

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
  /** payment: the debt it pays. needs_review: the card's debt, should the
   *  user call it a payment. */
  debtId: string | null;
  isFee: boolean;
  externalId: string;
  legacyExternalId: string | null;
  status: "new" | "duplicate";
  duplicateReason?: "same_movement" | "same_payment";
  possibleDuplicate?: PossibleDuplicate;
  /** A payment proposed only from a learned rule ("learned_payment"): the
   *  user confirms it; preselected when the amount is the instalment. */
  learnedPayment?: { preselect: boolean };
  warnings: RowWarning[];
}

export interface ClassifyInput {
  rows: NormalizedRow[];
  account: ClassifyAccount;
  debts: ClassifyDebt[];
  existing: ExistingMovement[];
  /** Card files: how purchases appear. Undefined → detected. */
  purchasesSign?: PurchasesSign;
  /** Bank rows (by rowIndex) the user's categorisation rules put on a debt's
   *  budget line (learnedPayments.ts): proposed as payments of that debt, for
   *  the user to confirm — never decided by the rule alone. */
  learnedPayments?: ReadonlyMap<number, LearnedPayment>;
}

export interface ClassifyResult {
  mode: ImportMode;
  rows: PlannedRow[];
  /** Card mode: the sign convention applied, and whether it was guessed.
   *  "unknown": not guessed — rows are read as holder's view (negative) only
   *  so the preview has something to show; the user must choose. */
  purchasesSign?: PurchasesSignGuess;
  purchasesSignDetected?: boolean;
}

// Matching windows, in days.
const SAME_PAYMENT_DAYS = 4;    // a card payment shows on the card a few days after the bank charge
// Further apart than SAME_PAYMENT_DAYS but within this, a payment of the same
// amount to the same card may still be the same one (slow issuers, weekends):
// not assumed, flagged as a possible duplicate for the user.
export const LATE_PAYMENT_DAYS = 10;
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
  "recibo visa", "recibo mastercard",
  "recibo tarjeta", "cargo tarjeta credito", "credit card payment", "credit card repayment", "card repayment",
];
// "PAGO TARJETA" also labels debit-card purchases ("PAGO TARJETA MERCADONA"):
// a card payment only when nothing but card words, numbers or the name of
// one of the user's cards follows it.
const PAGO_TARJETA = /(?:^| )pago (?:de (?:la )?)?tarjeta((?: [a-z0-9]+)*) $/;
const CARD_WORDS = new Set(["credito", "credit", "visa", "mastercard", "amex", "classic", "oro", "gold", "platinum", "n", "num", "no"]);

function isPagoTarjetaPayment(text: string, cardNames: string[]): boolean {
  const m = PAGO_TARJETA.exec(text);
  if (!m) return false;
  let rest = ` ${m[1].trim()} `;
  for (const name of cardNames) if (name.length >= 3) rest = rest.replace(` ${name} `, " ");
  return rest.trim().split(" ").filter(Boolean).every(tok => CARD_WORDS.has(tok) || /^\d+$/.test(tok) || /^x+\d*$/.test(tok));
}
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
  const cards = debts.filter(d => d.kind === "credit_card" && d.accountId && d.accountId !== account.id);
  if (!hasPhrase(text, BANK_CARD_PAYMENT) && !isPagoTarjetaPayment(text, cards.map(d => normalizeText(d.name)))) return null;
  if (cards.length === 1) return { debtId: cards[0].id };
  const named = cards.filter(d => {
    const n = normalizeText(d.name);
    return n.length >= 3 && text.includes(` ${n} `);
  });
  return { debtId: named.length === 1 ? named[0].id : null };
}

// Sign anchors: lines whose words say which way the money went, whatever the
// file's convention. Stricter than the classification phrases above ("recibo",
// "ingreso"… also label card charges), because a wrong vote flips every row.
const SIGN_CREDIT_ANCHORS = [
  "pago recibido", "su pago", "pago gracias", "abono pago", "abono de pago", "abono por pago",
  "payment received", "payment thank you", "thank you for your payment", ...CARD_REFUND,
];
const SIGN_DEBIT_ANCHORS = [
  "compra", "compras", "compra en", "compra tarj", "pago en", "purchase", "intereses", "interes", "comision", "interest",
];
/** Fewer voting lines than this and the convention isn't guessed. */
const SIGN_MIN_VOTES = 5;
/** The losing side may hold at most this share of the (weighted) votes. */
const SIGN_MAX_MINORITY = 0.25;

export type PurchasesSign = "negative" | "positive";
export type PurchasesSignGuess = PurchasesSign | "unknown";

/**
 * How a card statement writes purchases, or "unknown" when the file doesn't
 * say clearly enough — then the user chooses (a wrong guess turns every
 * purchase into a payment and the reverse).
 *
 * Anchored lines vote twice: a "PAGO RECIBIDO" / refund line is a credit and a
 * "COMPRA EN…" / interest line a debit, so their sign gives the convention.
 * Other lines vote once as purchases (the bulk of a statement). No guess with
 * fewer than SIGN_MIN_VOTES votes, when anchors contradict each other or the
 * bulk, or when the vote is close.
 */
export function guessPurchasesSign(rows: NormalizedRow[]): PurchasesSignGuess {
  let strongNeg = 0, strongPos = 0, weakNeg = 0, weakPos = 0;
  for (const r of rows) {
    if (r.amountCents === 0) continue;
    const text = textOf(r);
    const credit = hasPhrase(text, SIGN_CREDIT_ANCHORS);
    const debit = hasPhrase(text, SIGN_DEBIT_ANCHORS);
    if (credit && debit) continue; // "abono compra": says nothing about the sign
    if (credit) { if (r.amountCents > 0) strongNeg++; else strongPos++; }
    else if (debit) { if (r.amountCents < 0) strongNeg++; else strongPos++; }
    else if (r.amountCents < 0) weakNeg++;
    else weakPos++;
  }
  if (strongNeg + strongPos + weakNeg + weakPos < SIGN_MIN_VOTES) return "unknown";
  if (strongNeg > 0 && strongPos > 0) return "unknown";
  const neg = 2 * strongNeg + weakNeg, pos = 2 * strongPos + weakPos;
  if (Math.min(neg, pos) > SIGN_MAX_MINORITY * (neg + pos)) return "unknown";
  return neg > pos ? "negative" : "positive";
}

/** The rows as classified: zero lines dropped, card amounts turned to the
 *  holder's view by the sign convention (stated or guessed). */
function prepareRows(input: Pick<ClassifyInput, "rows" | "account" | "purchasesSign">) {
  const mode: ImportMode = input.account.type === "card" ? "card" : "account";
  let rows = input.rows.filter(r => r.amountCents !== 0);
  let purchasesSign: PurchasesSignGuess | undefined;
  let purchasesSignDetected: boolean | undefined;
  if (mode === "card") {
    purchasesSign = input.purchasesSign ?? guessPurchasesSign(rows);
    purchasesSignDetected = input.purchasesSign === undefined;
    if (purchasesSign === "positive") {
      rows = rows.map(r => ({ ...r, amountCents: -r.amountCents, feeCents: r.feeCents ? -Math.abs(r.feeCents) : r.feeCents }));
    }
  }
  return { mode, rows, purchasesSign, purchasesSignDetected };
}

/** Each row's fingerprint key and merchant (dedup, see the header). */
function keyRows(rows: NormalizedRow[], accountId: string | null): { key: string; merchant: string }[] {
  const accountKey = accountId ?? "none";
  const occurrences = new Map<string, number>();
  return rows.map(row => {
    const merchant = normalizeMerchant(row.description);
    if (row.externalRef) return { key: `v2|${accountKey}|ref|${row.externalRef}`, merchant };
    if (row.balanceCents !== null && row.balanceCents !== undefined) {
      return { key: `v2|${accountKey}|${row.date}|${row.amountCents}|${merchant}|bal:${row.balanceCents}`, merchant };
    }
    const same = `${row.date}|${row.amountCents}|${merchant}`;
    const n = occurrences.get(same) ?? 0;
    occurrences.set(same, n + 1);
    return { key: `v2|${accountKey}|${same}|#${n}`, merchant };
  });
}

/** Every id (both generations, and fees') classifyRows will give these rows —
 *  so the caller can load the stored movements under them in one query
 *  before classifying once. */
export function statementIds(input: Pick<ClassifyInput, "rows" | "account" | "purchasesSign">): string[] {
  const { rows } = prepareRows(input);
  return keyRows(rows, input.account.id).flatMap(({ key, merchant }, i) => {
    const r = rows[i];
    return [hash(key), legacyExternalId(r.date, r.amountCents, merchant, r.balanceCents), ...(r.feeCents ? [hash(`${key}|fee`)] : [])];
  });
}

/** Stored movements bucketed by amount (every match below needs the same
 *  amount), each bucket in date then id order: a lookup costs one bucket,
 *  not the whole history. */
function indexByAmount(existing: ExistingMovement[]): Map<number, ExistingMovement[]> {
  const out = new Map<number, ExistingMovement[]>();
  for (const e of existing) {
    const list = out.get(e.amountCents);
    if (list) list.push(e); else out.set(e.amountCents, [e]);
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return out;
}

export function classifyRows(input: ClassifyInput): ClassifyResult {
  const { account, debts, existing } = input;
  const { mode, rows, purchasesSign, purchasesSignDetected } = prepareRows(input);

  // Existing movements by id: both id generations, so an old import is found.
  const existingIds = new Set(existing.map(e => e.externalId).filter((id): id is string => !!id));
  const byAmount = indexByAmount(existing);
  const keys = keyRows(rows, account.id);
  const planned: PlannedRow[] = [];

  for (const [i, row] of rows.entries()) {
    const { key, merchant } = keys[i];

    const warnings: RowWarning[] = [];
    if (row.currency && account.currency && row.currency.toUpperCase() !== account.currency.toUpperCase()) {
      warnings.push("currency_mismatch");
    }

    let kind: PlannedKind;
    let debtId: string | null = null;
    let learnedPayment: PlannedRow["learnedPayment"];
    if (mode === "account") {
      if (row.amountCents > 0) kind = "income";
      else {
        // A card-payment phrase naming one card decides; a learned rule only proposes.
        const detected = detectCardPayment(row, account, debts);
        const learned = input.learnedPayments?.get(row.rowIndex);
        if (detected?.debtId) { kind = "payment"; debtId = detected.debtId; }
        else if (learned) {
          kind = "payment";
          debtId = learned.debtId;
          learnedPayment = { preselect: learned.preselect };
          warnings.push("learned_payment");
        } else {
          kind = "expense";
          if (detected) warnings.push("card_payment_unassigned");
        }
      }
    } else if (row.amountCents < 0) {
      kind = "expense";
    } else {
      const text = textOf(row);
      const matchesStoredPayment = !!account.cardDebtId && (byAmount.get(row.amountCents) ?? []).some(e =>
        e.table === "expense" && e.debtId === account.cardDebtId && daysApart(e.date, row.date) <= SAME_PAYMENT_DAYS);
      if (hasPhrase(text, CARD_REFUND)) kind = "refund";
      else if (account.cardDebtId && (matchesStoredPayment || hasPhrase(text, CARD_PAYMENT_RECEIVED))) {
        kind = "payment";
        debtId = account.cardDebtId;
      } else {
        kind = "needs_review";
        debtId = account.cardDebtId;
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
      ...(learnedPayment ? { learnedPayment } : {}),
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
  /**
   * One matching pass: pairs each eligible row with at most one unclaimed
   * stored movement of its amount, within `maxDays`, closest dates first.
   * Every candidate pair of the pass is weighed together, so the result
   * doesn't depend on the file's row order (BBVA lists newest first): a row
   * can't take, as a looser match, the stored movement another row needed as
   * its close one.
   */
  const matchPass = (
    eligible: (p: PlannedRow) => boolean,
    maxDays: number,
    pred: (p: PlannedRow, e: ExistingMovement) => boolean,
    apply: (p: PlannedRow, e: ExistingMovement) => void,
  ) => {
    const pairs: { p: PlannedRow; e: ExistingMovement; days: number }[] = [];
    for (const p of planned) {
      if (p.status !== "new" || !eligible(p)) continue;
      for (const e of byAmount.get(p.amountCents) ?? []) {
        if (claimed.has(e.id)) continue;
        const days = daysApart(e.date, p.date);
        if (days <= maxDays && pred(p, e)) pairs.push({ p, e, days });
      }
    }
    pairs.sort((a, b) => a.days - b.days || a.e.date.localeCompare(b.e.date) || a.e.id.localeCompare(b.e.id)
      || a.p.date.localeCompare(b.p.date) || a.p.externalId.localeCompare(b.p.externalId));
    const matched = new Set<PlannedRow>();
    for (const { p, e } of pairs) {
      if (matched.has(p) || claimed.has(e.id)) continue;
      matched.add(p);
      claimed.add(e.id);
      apply(p, e);
    }
  };

  // The same card payment seen from the other side (bank file ↔ card file):
  // ≤ SAME_PAYMENT_DAYS apart it IS that payment — this pass runs over every
  // row before any looser one. Further apart (≤ LATE_PAYMENT_DAYS), only
  // flagged. If the card side was stored as a REFUND (a credit the user
  // resolved the wrong way), it's no proof, but recording this payment too
  // would lower the debt twice: flagged as well.
  const toPossible = (e: ExistingMovement): PossibleDuplicate =>
    ({ id: e.id, table: e.table, date: e.date, description: e.description, source: e.source });
  const flag = (p: PlannedRow, e: ExistingMovement) => { p.possibleDuplicate = toPossible(e); };
  const isPayment = (p: PlannedRow) => p.kind === "payment" && !p.possibleDuplicate;
  const paysSameDebt = (p: PlannedRow, e: ExistingMovement) => e.table === "expense" && e.debtId === p.debtId;
  matchPass(isPayment, SAME_PAYMENT_DAYS, paysSameDebt, p => { p.status = "duplicate"; p.duplicateReason = "same_payment"; });
  matchPass(isPayment, LATE_PAYMENT_DAYS, paysSameDebt, flag);
  matchPass(isPayment, SAME_PAYMENT_DAYS, (p, e) => {
    const cardAccountId = debts.find(d => d.id === p.debtId)?.accountId ?? null;
    return !!cardAccountId && e.table === "expense" && e.kind === "refund" && e.accountId === cardAccountId;
  }, flag);

  // A card payment whose card couldn't be told (several cards): if one of
  // them already has a payment of that amount nearby, say so before the user
  // assigns it.
  const cardDebtIds = new Set(debts.filter(d => d.kind === "credit_card").map(d => d.id));
  matchPass(p => p.warnings.includes("card_payment_unassigned") && !p.possibleDuplicate, LATE_PAYMENT_DAYS,
    (_p, e) => e.table === "expense" && !!e.debtId && cardDebtIds.has(e.debtId) && e.kind !== "refund", flag);

  // Possible duplicates across sources: flagged, the user decides.
  const sameAccount = (e: ExistingMovement) => e.debtId === null && (e.accountId === account.id || e.accountId === null);
  matchPass(p => !p.isFee && !p.possibleDuplicate, POSSIBLE_DUP_DAYS, (p, e) => {
    const table = p.kind === "income" ? "income" : "expense";
    const storedKind = p.kind === "refund" ? "refund" : p.kind === "income" ? "income" : "expense";
    return e.table === table && (p.kind === "needs_review"
      // Either reading of the credit may already be stored.
      ? (e.kind === "refund" && sameAccount(e)) || (e.kind === "expense" && !!p.debtId && e.debtId === p.debtId)
      : (e.kind || "expense") === storedKind && (p.kind === "payment" ? e.debtId === p.debtId : sameAccount(e)));
  }, flag);

  return { mode, rows: planned, purchasesSign, purchasesSignDetected };
}
