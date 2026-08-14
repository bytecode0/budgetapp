// Income-side classification for the Radiografía.
//
// Not every inflow is earned income. A tax refund is your own money coming
// back; a loan disbursement is debt, not income; a card refund just undoes a
// purchase you already counted as spending. Counting these as income inflates
// every ratio the report shows — savings rate, giving %, the archetype — the
// exact same failure mode "uncertain" already fixes on the expense side, just
// facing the other direction.
//
// Three outcomes:
//   - income    : counts toward totalIncome (the default — most inflows are)
//   - excluded  : high-confidence keyword match, never earned income, dropped
//                 from totalIncome automatically (no user input needed)
//   - uncertain : could genuinely be either (a cash re-deposit, a transfer from
//                 another account of yours) — surfaced for the user to confirm,
//                 and NOT counted by default until they do (conservative: an
//                 unresolved ambiguous inflow must not inflate the verdict)
import { norm, hits } from "./wealth.js";

export type IncomeReason = "taxRefund" | "loanReceived" | "refund" | "cashDeposit" | "selfTransfer";
export type IncomeClass =
  | { type: "income" }
  | { type: "excluded"; reason: IncomeReason }
  | { type: "uncertain"; reason: IncomeReason };

// Money that already belonged to you, or was never yours to spend.
// NOTE: Spanish banks often write "I.R.P.F." with dots — norm() turns any
// punctuation run into a space, so "i.r.p.f" becomes four separate single-letter
// tokens ("i r p f"), not the word "irpf". Matched here as the literal
// space-joined phrase (same mechanism as any other multi-word keyword).
const TAX_REFUND = ["irpf", "i r p f", "aeat", "hacienda", "declaracion renta", "declaracion de la renta"];
const LOAN_RECEIVED = ["prestamo", "credito rapido", "minicredito", "financiacion concedida"];
// A positive amount that literally says "card payment" is a chargeback/refund —
// individuals don't receive money labelled as a card purchase any other way.
const REFUND = ["devolucion", "reembolso", "abono devolucion", "reintegro compra", "pago con tarjeta"];

// Genuinely ambiguous: could be new money, could be money you already had.
const CASH_DEPOSIT = ["ingreso en efectivo", "deposito en efectivo", "deposito efectivo"];
// Other banks/brokers you might hold an account at — an inflow named after one
// of these often means money moving between your OWN accounts, not new income.
const SELF_TRANSFER_SOURCE = [
  "n26", "revolut", "wise", "openbank", "trade republic", "traderepublic",
  "myinvestor", "my investor", "imagin", "bunq", "monzo",
];

export function classifyIncome(fullText: string): IncomeClass {
  const c = norm(fullText);
  if (hits(c, TAX_REFUND)) return { type: "excluded", reason: "taxRefund" };
  if (hits(c, LOAN_RECEIVED)) return { type: "excluded", reason: "loanReceived" };
  if (hits(c, REFUND)) return { type: "excluded", reason: "refund" };
  if (hits(c, CASH_DEPOSIT)) return { type: "uncertain", reason: "cashDeposit" };
  if (hits(c, SELF_TRANSFER_SOURCE)) return { type: "uncertain", reason: "selfTransfer" };
  return { type: "income" };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (ch) => ch.toUpperCase());

/** A stable override key + display label for an ambiguous inflow. */
export function describeIncomeUncertain(fullText: string, reason: IncomeReason): { key: string; detail: string | null } {
  if (reason === "cashDeposit") return { key: "in:cash", detail: null };
  const c = norm(fullText);
  const source = SELF_TRANSFER_SOURCE.find(s => hits(c, [s]));
  return source ? { key: `in:${source.replace(/\s+/g, "-")}`, detail: titleCase(source) } : { key: "in:transfer", detail: null };
}
