// Amounts as written by banks → integer cents. Pure; runs in Node and browser.
//
// Handles "1.234,56" / "1,234.56" / "1.234" / "1,234" / "-12,34" / "(12.34)" /
// "12,34-" / "+5" / "€ 12,50" / "12.50 EUR" / "1 234,56" / "1'234.56". The
// arithmetic is done on the digit strings, never on a float, so "0,1" is
// exactly 10 cents.
//
// The only real ambiguity is ONE separator followed by exactly three digits:
// "1.234" is 1234 in Spain and 1.234 in a 3-decimal world; "1,234" is 1234 in
// English. Money has two decimals, so it's read as a thousands separator —
// unless the caller knows the file's decimal separator (detectDecimal() on
// the whole column, or a saved mapping) and it says otherwise.

export type DecimalSeparator = "," | ".";

/** The column's decimal separator, judged from values that can only be read
 *  one way ("12,34" → ","; "1,234.56" → "."). Null when nothing is conclusive. */
export function detectDecimal(values: unknown[]): DecimalSeparator | null {
  let comma = 0, dot = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const s = v.replace(/[^\d.,]/g, "");
    const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) comma++; else dot++;
      continue;
    }
    const sep = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
    if (!sep) continue;
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length === 2 && (tail.length === 1 || tail.length === 2)) {
      if (sep === ",") comma++; else dot++;
    }
  }
  if (comma === dot) return null;
  return comma > dot ? "," : ".";
}

/** Parses an amount cell into signed integer cents, or null if it isn't one. */
export function parseAmountCents(raw: unknown, decimal?: DecimalSeparator | null): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  // Currency codes/symbols and spacing (incl. NBSP, narrow NBSP), Swiss apostrophes.
  s = s.replace(/[A-Za-z€$£¥\s  ']/g, "");
  if (s.startsWith("-")) { negative = !negative; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  if (s.endsWith("-")) { negative = !negative; s = s.slice(0, -1); }
  else if (s.endsWith("+")) s = s.slice(0, -1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  let decimalSep: DecimalSeparator | null = null;
  if (lastComma >= 0 && lastDot >= 0) {
    decimalSep = lastComma > lastDot ? "," : ".";
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep: DecimalSeparator = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length > 2) decimalSep = null;                       // "1.234.567": thousands only
    else if (tail.length === 3) decimalSep = decimal === sep ? sep : null; // "1.234": see header
    else decimalSep = sep;
  }

  let intPart = s, fracPart = "";
  if (decimalSep) {
    const i = s.lastIndexOf(decimalSep);
    intPart = s.slice(0, i);
    fracPart = s.slice(i + 1);
  }
  const thousands = decimalSep === "," ? "." : decimalSep === "." ? "," : null;
  intPart = thousands ? intPart.split(thousands).join("") : intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;

  // Two decimals exactly; a third digit rounds half away from zero.
  const frac2 = (fracPart + "00").slice(0, 2);
  let cents = Number(intPart || "0") * 100 + Number(frac2);
  if (fracPart.length > 2 && Number(fracPart[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}
