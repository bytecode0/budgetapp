// Norma 43 (AEB/CSB 43) → rows. Pure; runs in Node and browser.
//
// The Spanish banking standard for account statements: fixed-width records of
// 80 characters, one per line, identified by their first two digits.
//   11  account header — bank, branch, account, dates, opening balance (sign
//       key 1 = debit, 2 = credit), currency (ISO 4217 numeric)
//   22  movement — op. date (YYMMDD, pos 11-16), value date (17-22), common
//       concept (23-24), own concept (25-27), sign key (28: 1 debit, 2
//       credit), amount (29-42, 14 digits with 2 implied decimals), document
//       no. (43-52), reference 1 (53-64), reference 2 (65-80)
//   23  optional concept lines for the preceding 22 (two 38-char texts)
//   24  currency equivalence (ignored), 33 account footer, 88 end of file
// The running balance is derived from the opening balance, so every movement
// gets one (which is what dedup uses to tell identical movements apart).
import type { NormalizedRow, ReadResult } from "../types.js";

const CURRENCY_BY_NUMERIC: Record<string, string> = { "978": "EUR", "840": "USD", "826": "GBP", "756": "CHF" };

// Common concepts (pos 23-24) — a fallback label when a movement has no 23 lines.
const COMMON_CONCEPTS: Record<string, string> = {
  "01": "Talones - reintegros", "02": "Abonaré - entregas - ingresos", "03": "Domiciliado - recibos - letras - pagos por su cuenta",
  "04": "Giros - transferencias - traspasos - cheques", "05": "Amortización préstamos, créditos", "06": "Remesas efectos",
  "07": "Suscripciones - div. pasivos - canje", "08": "Div. cupones - prima junta - amortizaciones", "09": "Operaciones de bolsa",
  "10": "Cheques gasolina", "11": "Cajero automático", "12": "Tarjetas de crédito - tarjetas de débito",
  "13": "Operaciones extranjero", "14": "Devoluciones e impagados", "15": "Nóminas - seguros sociales",
  "16": "Timbres - corretaje - póliza", "17": "Intereses - comisiones - custodia - gastos e impuestos", "98": "Anulaciones - correcciones asiento", "99": "Varios",
};

const day = (yymmdd: string): string | null => {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const y = 2000 + Number(yymmdd.slice(0, 2)), m = Number(yymmdd.slice(2, 4)), d = Number(yymmdd.slice(4, 6));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
};

const signed = (key: string, digits: string): number | null =>
  /^\d{14}$/.test(digits) && (key === "1" || key === "2") ? (key === "1" ? -1 : 1) * Number(digits) : null;

/** Whether the text is a Norma 43 file (first record is an account header). */
export function looksLikeNorma43(text: string): boolean {
  const first = text.split(/\r\n|\n|\r/).find(l => l.trim());
  return !!first && /^11\d{18}\d{6}\d{6}[12]\d{14}\d{3}/.test(first);
}

export function readNorma43(text: string): ReadResult {
  const rows: NormalizedRow[] = [];
  const skipped: ReadResult["skipped"] = [];
  let balance: number | null = null;
  let currency: string | null = null;
  let current: NormalizedRow | null = null;
  const concepts: string[] = [];
  let index = 0;

  const flush = () => {
    if (!current) return;
    if (concepts.length) current.description = concepts[0];
    if (concepts.length > 1) current.details = concepts.slice(1).join(" ");
    rows.push(current);
    current = null;
    concepts.length = 0;
  };

  for (const rawLine of text.split(/\r\n|\n|\r/)) {
    const line = rawLine.padEnd(80, " ");
    const type = line.slice(0, 2);
    if (type === "11") {
      flush();
      balance = signed(line.slice(32, 33), line.slice(33, 47));
      currency = CURRENCY_BY_NUMERIC[line.slice(47, 50)] ?? null;
    } else if (type === "22") {
      flush();
      const rowIndex = index++;
      const date = day(line.slice(10, 16));
      const amountCents = signed(line.slice(27, 28), line.slice(28, 42));
      if (!date || amountCents === null) { skipped.push({ rowIndex, reason: !date ? "no_date" : "no_amount" }); continue; }
      if (balance !== null) balance += amountCents;
      const ref1 = line.slice(52, 64).trim(), ref2 = line.slice(64, 80).trim();
      const common = line.slice(22, 24);
      current = {
        rowIndex,
        date,
        amountCents,
        description: COMMON_CONCEPTS[common] ?? "",
        balanceCents: balance,
        currency,
        externalRef: null,
      };
      if (ref1 || ref2) current.details = [ref1, ref2].filter(Boolean).join(" ");
    } else if (type === "23" && current) {
      for (const part of [line.slice(4, 42), line.slice(42, 80)]) {
        const t = part.replace(/\s+/g, " ").trim();
        if (t) concepts.push(t);
      }
    } else if (type === "33" || type === "88") {
      flush();
    }
  }
  flush();
  return { rows, skipped, source: "norma43", currency };
}
