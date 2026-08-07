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
  "indexa", "myinvestor", "my investor", "trade republic", "traderepublic", "degiro",
  "xtb", "etoro", "interactive brokers", "renta 4", "renta4", "scalable", "trading 212",
  "trading212", "coinbase", "binance", "kraken", "bit2me", "bitpanda", "finizens",
  "plan de pensiones", "pension", "pensiones", "fondo", "fondos", "broker", "inversion",
  "bolsa", "acciones", "etf", "openbank invest", "traspaso a fondo",
];
const SAVINGS = ["ahorro", "hucha", "cuenta de ahorro", "objetivo de ahorro", "savings"];
// Tithing, offerings, donations to churches/NGOs — stewardship, not spending.
const GIVING = [
  "diezmo", "diezmos", "ofrenda", "ofrendas", "donacion", "donaciones", "donativo", "donativos",
  "limosna", "iglesia", "parroquia", "caritas", "cruz roja", "unicef", "manos unidas",
  "aldeas infantiles", "world vision", "ong", "fundacion", "mision", "misiones", "diaconia",
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
function norm(s: string): string {
  const spaced = (s ?? "").replace(/([a-z])([A-Z])/g, "$1 $2");
  return ` ${spaced.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
}

// A needle matches only as a whole word / phrase, bounded by spaces.
function hits(haystack: string, needles: string[]): boolean {
  return needles.some(n => haystack.includes(` ${n} `));
}

export function classifyMovement(concept: string): MovementClass {
  const c = norm(concept);
  if (hits(c, GIVING)) return { type: "wealth", kind: "giving" };
  if (hits(c, INVESTMENT)) return { type: "wealth", kind: "investment" };
  if (hits(c, SAVINGS)) return { type: "wealth", kind: "savings" };
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
