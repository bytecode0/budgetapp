// Normalizes a free-text expense description into a stable merchant key.
// Used to power auto-categorization (Fase B) and recurring detection (Fase F),
// so the same shop always maps to the same key regardless of casing, accents,
// legal suffixes or trailing reference numbers.
//
// Examples:
//   "MERCADONA"            -> "mercadona"
//   "Mercadona SA 1234"    -> "mercadona"
//   "Café López"           -> "cafe lopez"

// Legal-entity suffixes and payment-noise tokens that carry no merchant identity.
const NOISE_TOKENS = new Set([
  "sa", "sl", "slu", "sau", "sln", "scp", "sc",
  "sociedad", "limitada", "ltda", "ltd", "inc", "llc", "co",
  "pago", "compra", "recibo", "tarj", "tarjeta", "transferencia", "bizum",
  // Bank boilerplate on transfer rows. Never part of a merchant's identity, and
  // leaving them in produced merchant keys like "realizada" for every transfer.
  "realizada", "realizado", "emitida", "emitido", "recibida", "recibido",
  "enviado", "enviada", "traspaso",
]);

/**
 * True when a description carries no merchant identity at all — every token is
 * bank boilerplate (e.g. "Transferencia realizada", "Bizum"). Callers with a
 * richer detail field should prefer that instead of this label.
 */
// Connectors are ignored for this check only — deliberately NOT added to
// NOISE_TOKENS, since removing them would change merchant keys that are already
// stored (and that recurring detection groups by) across the whole app.
const CONNECTORS = new Set(["con", "de", "del", "la", "el", "los", "las", "en", "por", "para", "al", "y"]);

export function isNoiseOnly(input: string | null | undefined): boolean {
  if (!input) return true;
  const tokens = input
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every(
    tok => NOISE_TOKENS.has(tok) || CONNECTORS.has(tok) || /^\d+$/.test(tok) || tok.length === 1
  );
}

// Revolut (and similar neobanks) export card purchases as a full sentence with
// the amount baked in, e.g. "Card Transaction Of 15.00 EUR Issued By Iglesia
// Lego De Las Buena Torrejon De ...". None of those boilerplate words are in
// NOISE_TOKENS, so they'd otherwise stick to the merchant key — harmless when
// every occurrence has the same prefix, but worth stripping so the merchant
// name itself reads cleanly wherever it's displayed.
const CARD_TXN_PREFIX = /^card transaction of[\s\d.,]*(?:eur|usd|gbp)\s+issued by\s+/i;

export function normalizeMerchant(input: string | null | undefined): string {
  if (!input) return "";

  const withoutBoilerplate = input.replace(CARD_TXN_PREFIX, "");

  const cleaned = withoutBoilerplate
    .toLowerCase()
    .normalize("NFD") // split accented chars into base + diacritic
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks)
    .replace(/[^a-z0-9\s]/g, " ") // drop punctuation/symbols
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const tokens = cleaned.split(" ").filter((tok) => {
    if (NOISE_TOKENS.has(tok)) return false;
    if (/^\d+$/.test(tok)) return false; // pure reference numbers
    if (tok.length === 1 && /[a-z]/.test(tok)) return false; // leftover letters from "S.A." etc.
    return true;
  });

  // If filtering removed everything (e.g. input was only a number), fall back
  // to the cleaned string so we never lose the merchant entirely.
  return tokens.length > 0 ? tokens.join(" ") : cleaned;
}
