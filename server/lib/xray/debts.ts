// Debt / cuota payment detection for the Radiografía — the "futuro
// comprometido" pivot (see memory `budgetapp-product-pivot-deuda`): the % of
// income already reserved to fragmented consumer debt (cards, BNPL, payday
// loans, car finance), as opposed to `commitments` (recurring subscriptions),
// which stays a separate, unrelated pillar.
//
// Mirrors wealth.ts exactly: norm() (lowercase, accent-stripped, padded) +
// hits() (whole-word) matching against the RAW transaction concept, so e.g.
// "financiacion" as a standalone word matches but a merchant that merely
// contains that substring inside a longer token does not.
//
// Reuses the SAME `kind` taxonomy as the authenticated `Debt` model
// (prisma/schema.prisma) — the Radiografía never invents its own classification.
export type DebtKind = "credit_card" | "installment" | "bnpl" | "payday_loan" | "auto_loan" | "other";

const BNPL = ["klarna", "sequra", "aplazame", "scalapay", "clearpay", "afterpay"];
const PAYDAY = ["vivus", "creditea", "moneyman", "cashper", "prestamo rapido", "minicredito"];
const AUTO_LOAN = ["financiacion coche", "financiacion vehiculo", "prestamo coche"];
const CREDIT_CARD = ["revolving", "pago aplazado tarjeta"];
const INSTALLMENT_GENERIC = ["cuota prestamo", "financiacion", "prestamo personal"];
// Detected but EXCLUDED from the futuro comprometido % — see classifyDebt below.
const MORTGAGE = ["hipoteca"];

// Same normalize-to-space-delimited-words approach as wealth.ts.
function norm(s: string): string {
  const spaced = (s ?? "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return ` ${spaced.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// A needle matches only as a whole word / phrase, bounded by spaces.
function hits(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(` ${n} `));
}

/**
 * Classify a raw transaction concept as a debt kind, `"mortgage"` (detected
 * but excluded from the futuro comprometido %), or `null` (not debt-like).
 *
 * Design decision: a mortgage is shown separately, informatively, without
 * penalizing the score. The product's target user is someone drowning in
 * fragmented consumer debt, not a homeowner on a 30-year mortgage — folding
 * the two into the same percentage would distort the metric for any owner.
 */
export function classifyDebt(concept: string): DebtKind | "mortgage" | null {
  const c = norm(concept);
  if (hits(c, MORTGAGE)) return "mortgage";
  if (hits(c, BNPL)) return "bnpl";
  if (hits(c, PAYDAY)) return "payday_loan";
  if (hits(c, AUTO_LOAN)) return "auto_loan";
  if (hits(c, CREDIT_CARD)) return "credit_card";
  if (hits(c, INSTALLMENT_GENERIC)) return "installment";
  return null;
}

// The two shapes detectDebtPayments needs, decoupled from analyze.ts's
// internal PreparedTxn so this module has no upstream dependency.
export interface DebtRecurringInput { merchant: string; avgAmount: number } // cents/month
export interface DebtTxnInput { merchant: string; concept: string; amount: number } // cents (single charge)

export interface DetectedDebtItem { merchant: string; kind: DebtKind; monthlyAmount: number } // cents/month

export interface DebtDetection {
  monthlyTotal: number; // cents/month; mortgage excluded
  items: DetectedDebtItem[];
  mortgage: { detected: boolean; monthlyAmount: number } | null;
}

/**
 * Detect debt/cuota payments both from the already-computed recurring
 * commitments AND directly from the raw transaction list.
 *
 * Recurring merchants (repeated across >=minMonths distinct months) are the
 * most accurate source — `avgAmount` is already a stable average — so they're
 * used whenever available. But `detectRecurringFrom` requires at least 2
 * distinct months (see recurring.ts), which is IMPOSSIBLE to satisfy on a
 * single-month statement — the most common upload for this public lead
 * magnet. Without a fallback, `debts.monthlyTotal` would always read 0 for
 * that case regardless of real debt payments present.
 *
 * So merchants NOT covered by recurring are still classified directly from
 * their raw transactions: a debt classification from a strong keyword match
 * (Klarna, Cofidis, "cuota prestamo", etc.) is already high-confidence on its
 * own — unlike generic recurring-merchant detection, which needs repetition
 * to avoid false positives on one-off subscriptions. The monthly estimate for
 * these is the average of that merchant's occurrences within the statement
 * (or the single occurrence itself, if it only appears once).
 *
 * A merchant is never counted from both sources.
 */
export function detectDebtPayments(recurringItems: DebtRecurringInput[], txns: DebtTxnInput[]): DebtDetection {
  const conceptByMerchant = new Map<string, string>();
  const txnsByMerchant = new Map<string, DebtTxnInput[]>();
  for (const t of txns) {
    if (!conceptByMerchant.has(t.merchant)) conceptByMerchant.set(t.merchant, t.concept);
    const arr = txnsByMerchant.get(t.merchant) ?? [];
    arr.push(t);
    txnsByMerchant.set(t.merchant, arr);
  }

  const items: DetectedDebtItem[] = [];
  let mortgageAmount = 0;
  let mortgageDetected = false;
  const recurringMerchants = new Set(recurringItems.map(r => r.merchant));

  // Primary source: recurring merchants (most accurate — already-averaged amount).
  for (const r of recurringItems) {
    const concept = conceptByMerchant.get(r.merchant) ?? r.merchant;
    const kind = classifyDebt(concept);
    if (kind === "mortgage") {
      mortgageDetected = true;
      mortgageAmount += r.avgAmount;
      continue;
    }
    if (kind) items.push({ merchant: r.merchant, kind, monthlyAmount: r.avgAmount });
  }

  // Fallback source: merchants not covered by recurring detection — classify
  // directly from the raw transactions so a single-month statement (or a debt
  // that only appears once so far) still counts.
  for (const [merchant, group] of txnsByMerchant) {
    if (recurringMerchants.has(merchant)) continue;
    const kind = classifyDebt(group[0].concept);
    if (!kind) continue;
    const monthlyAmount = Math.round(group.reduce((s, t) => s + t.amount, 0) / group.length);
    if (kind === "mortgage") {
      mortgageDetected = true;
      mortgageAmount += monthlyAmount;
      continue;
    }
    items.push({ merchant, kind, monthlyAmount });
  }

  return {
    monthlyTotal: items.reduce((s, i) => s + i.monthlyAmount, 0),
    items: items.sort((a, b) => b.monthlyAmount - a.monthlyAmount),
    mortgage: mortgageDetected ? { detected: true, monthlyAmount: mortgageAmount } : null,
  };
}

/**
 * Simple division — no pay-cycle projection needed here, unlike
 * `buildDebtTimeline` (authenticated area), which needs the statement day to
 * project forward. The Radiografía only has an average monthly income from
 * the uploaded statement. Both arguments must be in the same unit (cents, or
 * euros) — the ratio is unit-agnostic.
 */
export function computeFuturoComprometido(monthlyDebtTotal: number, avgMonthlyIncome: number): { pctOfIncome: number; monthlyTotal: number } {
  return {
    pctOfIncome: avgMonthlyIncome > 0 ? monthlyDebtTotal / avgMonthlyIncome : 0,
    monthlyTotal: monthlyDebtTotal,
  };
}
