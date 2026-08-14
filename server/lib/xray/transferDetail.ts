// Transfer / cash movement labelling for the Radiografía (R6+).
//
// normalizeMerchant strips exactly the tokens that identify a transfer
// ("transferencia", "bizum", digits), so ambiguous movements would otherwise
// show a blank label and all collapse into one group. Here we read the RAW
// concept to (a) extract a human detail — the counterparty name or the masked
// last-4 of the destination account — and (b) produce a STABLE, namespaced
// grouping key ("t:"/"c:") that can never collide with a normalized merchant,
// so it doubles as the reclassification-override key.
import { normalizeMerchant } from "../normalizeMerchant.js";

export interface MovementDetail {
  detail: string | null;   // counterparty name, "••1234", or null
  movementKey: string;     // e.g. "t:juan", "t:1234", "t:unknown", "c:atm"
}

const KEYWORDS = ["transferencia", "transf", "bizum", "traspaso", "envio"];
const CONNECTORS = new Set(["a", "de", "para", "favor", "al", "la", "el", "los", "las", "del", "d", "en", "por"]);
// Bank boilerplate that sits between the keyword and the actual counterparty
// ("Transferencia realizada Luis Vespa", "Bizum enviado: Ana"). Skipped like a
// connector so the label reads "Luis Vespa", not "Realizada Luis Vespa" — this
// text is shown to the user when they classify their own movements.
const BOILERPLATE = new Set([
  "realizada", "realizado", "emitida", "emitido", "recibida", "recibido",
  "enviado", "enviada", "concepto", "sin", "compra", "pago", "devuelta",
]);

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Last run of ≥4 digits in the concept (a partial account / IBAN tail).
function lastAccountTail(concept: string): string | null {
  const runs = concept.match(/\d{4,}/g);
  if (!runs || runs.length === 0) return null;
  return runs[runs.length - 1].slice(-4);
}

// Counterparty name: tokens after a transfer keyword (+ connectors), stopping at
// the first token containing a digit (account/reference). Names have no digits.
function extractName(concept: string): string | null {
  const tokens = concept.split(/\s+/).filter(Boolean);
  // Strip punctuation for the set lookups — banks write "Enviado:" / "favor,",
  // and a trailing colon must not stop a token from being recognised as noise.
  const folded = tokens.map(t => fold(t).replace(/[^a-z0-9]/g, ""));
  let start = -1;
  for (let i = 0; i < folded.length; i++) {
    if (KEYWORDS.some(k => folded[i].startsWith(k))) { start = i; break; }
  }
  if (start === -1) return null;

  const name: string[] = [];
  for (let i = start + 1; i < tokens.length && name.length < 3; i++) {
    const f = folded[i];
    if (CONNECTORS.has(f)) { if (name.length > 0) break; else continue; }
    // Boilerplate before the name is noise; once a name has started, it marks
    // the end of it (e.g. "… Ana Compra" → "Ana").
    if (BOILERPLATE.has(f)) { if (name.length > 0) break; else continue; }
    if (/\d/.test(f)) break;        // account/reference token → stop
    if (!/[a-z]/.test(f)) continue; // punctuation-only → skip
    name.push(tokens[i]);
  }
  const joined = name.join(" ").trim();
  return joined.length >= 2 ? titleCase(joined) : null;
}

/** Describe an uncertain movement (transfer or cash). Never throws. */
export function describeMovement(concept: string, kind: "transfer" | "cash"): MovementDetail {
  if (kind === "cash") {
    const m = normalizeMerchant(concept);
    return { detail: null, movementKey: `c:${m || "atm"}` };
  }
  try {
    const name = extractName(concept);
    if (name) return { detail: name, movementKey: `t:${slug(name) || "unknown"}` };
    const tail = lastAccountTail(concept);
    if (tail) return { detail: `••${tail}`, movementKey: `t:${tail}` };
  } catch { /* fall through */ }
  return { detail: null, movementKey: "t:unknown" };
}
