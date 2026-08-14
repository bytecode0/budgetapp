// Wealth-movement classification for the Radiografía (R7).
//
// Not every outflow is consumption. Transfers to your own savings, broker
// deposits, pension contributions and stock purchases are wealth you still own —
// counting them as "spending" wrongly tanks the health score. We classify each
// outflow into:
//   - consumption : real spending
//   - wealth      : savings / investment (high confidence, keyword-detected)
//   - uncertain   : generic transfers & cash (could be own-account savings OR a
//                   payment to a person) — surfaced for the user to confirm.
//
// We match against the RAW concept, not the normalized merchant: normalizeMerchant
// strips exactly the tokens we need here ("transferencia", "bizum", …).

export type MovementType = "consumption" | "wealth" | "uncertain";
export type MovementKind = "savings" | "investment" | "giving" | "transfer" | "cash" | null;
export interface MovementClass { type: MovementType; kind: MovementKind }

// Brokers, robo-advisors, crypto exchanges, pensions, funds.
const INVESTMENT = [
  // Brokers & robo-advisors
  "indexa", "myinvestor", "my investor", "trade republic", "traderepublic", "degiro",
  "xtb", "etoro", "interactive brokers", "renta 4", "renta4", "scalable", "trading 212",
  "trading212", "finizens", "openbank invest", "inbestme", "ninety nine", "freedom24",
  "lightyear", "revolut trading", "heytrade", "activotrade", "clicktrade", "selfbank",
  // Crypto exchanges & assets
  "coinbase", "binance", "kraken", "bit2me", "bitpanda", "bitstamp", "bitso", "gemini",
  "crypto", "cripto", "criptomoneda", "criptomonedas", "bitcoin", "btc", "ethereum",
  // Funds, index products, pensions. NOTE: bare "fondo"/"fondos" is deliberately
  // NOT here — in Spanish it is ambiguous ("fondo de emergencia" is savings,
  // "fondo Maritza" is a Bizum to a person). Only qualified phrases count.
  "plan de pensiones", "pension", "pensiones", "broker", "inversion",
  "inversiones", "bolsa", "acciones", "etf", "etfs", "indexado", "indexados",
  "vanguard", "ishares", "amundi", "msci", "sp 500", "s p 500",
  "fondo indexado", "fondo de inversion", "fondos de inversion", "traspaso a fondo",
  // Crowdlending / real-estate platforms
  "urbanitae", "housers", "mintos", "wecity",
];
const SAVINGS = [
  "ahorro", "ahorros", "hucha", "cuenta de ahorro", "objetivo de ahorro",
  "saving", "savings", "fondo de emergencia", "colchon",
];
// Tithing, offerings, donations to churches/NGOs — stewardship, not spending.
const GIVING = [
  "diezmo", "diezmos", "ofrenda", "ofrendas", "donacion", "donaciones", "donativo", "donativos",
  "limosna", "iglesia", "parroquia", "caritas", "cruz roja", "unicef", "manos unidas",
  "aldeas infantiles", "world vision", "ong", "fundacion", "mision", "misiones", "diaconia",
];
// Unambiguous real-world obligations. A transfer or Bizum that names one of
// these is NOT an ambiguous movement — it's spending, and must be counted as
// such. Without this, rent paid by bank transfer (very common) lands in
// "uncertain", gets excluded from consumption, and inflates the savings rate to
// something absurd. Kept to words that can't plausibly be a person's name, and
// matched whole-word, so "Bizum a Ana" never trips it.
const REAL_EXPENSE = [
  "alquiler", "hipoteca", "fianza", "comunidad de propietarios", "administrador de fincas",
  "colegio", "guarderia", "matricula", "universidad", "academia",
  "seguro", "abogado", "abogados", "gestoria", "asesoria", "notaria",
  "multa", "impuesto", "impuestos", "irpf", "hacienda", "autonomos", "seguridad social",
  "dentista", "clinica", "veterinario", "gimnasio", "comedor",
];
const TRANSFER = ["transferencia", "traspaso", "bizum", "envio de dinero", "envio a", "transf"];
const CASH = ["cajero", "reintegro", "retirada de efectivo", "retirada efectivo", "disposicion efectivo", "atm", "efectivo"];

// Normalize to space-delimited words (punctuation → spaces), padded so we can
// match whole words. Substring matching is unsafe here — e.g. "netflix" contains
// "etf" and would falsely read as an investment.
//
// Some banks concatenate their fixed label directly onto the user's own
// reference text with no separator (e.g. "Transferencia realizadaDiezmo - ...").
// A lowercase→uppercase transition reliably marks that boundary, so we split
// there before anything else — this can only ADD word breaks, never merge
// two real words together, so it's safe for every existing keyword list too.
// Exported so income.ts can reuse the exact same whole-word matching semantics
// instead of re-implementing (and risking a subtly different) normalizer.
export function norm(s: string): string {
  const spaced = (s ?? "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return ` ${spaced.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// A needle matches only as a whole word / phrase, bounded by spaces.
export function hits(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(` ${n} `));
}

export function classifyMovement(concept: string): MovementClass {
  const c = norm(concept);
  if (hits(c, GIVING)) return { type: "wealth", kind: "giving" };
  if (hits(c, INVESTMENT)) return { type: "wealth", kind: "investment" };
  if (hits(c, SAVINGS)) return { type: "wealth", kind: "savings" };
  // Checked before TRANSFER: a named obligation outranks the transfer heuristic.
  if (hits(c, REAL_EXPENSE)) return { type: "consumption", kind: null };
  if (hits(c, TRANSFER)) return { type: "uncertain", kind: "transfer" };
  if (hits(c, CASH)) return { type: "uncertain", kind: "cash" };
  return { type: "consumption", kind: null };
}

// True when a concept looks like a transfer (either direction). Used to pair an
// outflow in one uploaded account with the matching inflow in another. Salary /
// payroll inflows are intentionally NOT transfer-like, so they never reconcile.
export function isTransferLike(concept: string): boolean {
  return hits(norm(concept), TRANSFER);
}
