// Rules that put a merchant on a debt's budget line ("learned" from an earlier
// import or edit) are only a SUGGESTION that a bank row pays that debt. Pure.
//
// A rule keyed on a generic label ("Transferencia realizada", "Bizum",
// "Recibo"…) says nothing about which debt — the user's rent transfer and the
// loan instalment share it — so for those no debt-line rule is learned and an
// existing one is ignored. For a specific merchant the row is proposed as a
// payment, preselected only when its amount is the debt's instalment (±1 €);
// otherwise the user confirms it in the preview.
import { isNoiseOnly, normalizeMerchant } from "../normalizeMerchant.js";

/** Words that label HOW money moved, not WHO got it. */
const GENERIC_WORDS = new Set([
  "transferencia", "transferencias", "traspaso", "traspasos", "bizum", "recibo", "recibos", "pago", "pagos",
  "cargo", "cargos", "abono", "abonos", "ingreso", "ingresos", "domiciliacion", "domiciliado", "adeudo",
  "orden", "envio", "sepa", "cuota", "mensualidad", "prestamo", "operacion", "movimiento", "devolucion",
  "transfer", "transfers", "payment", "payments", "direct", "debit", "credit", "standing", "instant", "sent", "received",
  "realizada", "realizado", "emitida", "emitido", "recibida", "recibido", "enviada", "enviado", "inmediata",
  "periodica", "favor", "nomina", "tarjeta", "tarj", "cuenta", "banco", "bank", "to", "from",
]);
const CONNECTORS = new Set(["a", "de", "del", "la", "el", "en", "por", "para", "al", "y", "con"]);
/** Merchant keys shorter than this identify nothing reliably. */
const MIN_SPECIFIC_LENGTH = 4;
/** How far an amount may be from the debt's instalment to be preselected. */
export const INSTALLMENT_TOLERANCE_CENTS = 100;

/** True when a merchant key could be anyone: a transfer, a Bizum, a direct
 *  debit, or too short to tell. */
export function isGenericMerchant(merchant: string | null | undefined): boolean {
  const m = normalizeMerchant(merchant ?? "");
  if (m.replace(/\s/g, "").length < MIN_SPECIFIC_LENGTH || isNoiseOnly(m)) return true;
  return m.split(" ").every(tok => GENERIC_WORDS.has(tok) || CONNECTORS.has(tok) || /^\d+$/.test(tok) || tok.length <= 2);
}

export interface LearnedPayment {
  debtId: string;
  /** Proposed checked: a specific merchant AND the debt's instalment amount. */
  preselect: boolean;
}

export interface LearnedDebt {
  id: string;
  accountId: string | null;
  installmentAmount: number | null;
  minimumPayment: number | null;
}

/** Whether a learned payment of `amountCents` to `debt` is proposed checked. */
export function preselectLearnedPayment(amountCents: number, debt: LearnedDebt): boolean {
  const expected = debt.installmentAmount ?? debt.minimumPayment;
  return expected !== null && expected > 0 && Math.abs(Math.abs(amountCents) - expected) <= INSTALLMENT_TOLERANCE_CENTS;
}

/**
 * Bank rows a rule puts on a debt's line → the payment to propose, by rowIndex.
 * `ruleFor` returns the rule's allocation; `debtByLine` maps debt lines to
 * their debt. Generic merchants, a card's own debt, and unknown debts never
 * produce a suggestion.
 */
export function suggestLearnedPayments(
  rows: { rowIndex: number; description: string; merchant: string; amountCents: number }[],
  opts: {
    accountId: string | null;
    ruleFor: (r: { description: string; merchant: string }) => string | null;
    debtByLine: ReadonlyMap<string, string>;
    debts: ReadonlyMap<string, LearnedDebt>;
  },
): Map<number, LearnedPayment> {
  const out = new Map<number, LearnedPayment>();
  for (const r of rows) {
    if (isGenericMerchant(r.merchant)) continue;
    const line = opts.ruleFor(r);
    const debt = line ? opts.debts.get(opts.debtByLine.get(line) ?? "") : undefined;
    if (!debt || (debt.accountId && debt.accountId === opts.accountId)) continue;
    out.set(r.rowIndex, { debtId: debt.id, preselect: preselectLearnedPayment(r.amountCents, debt) });
  }
  return out;
}
