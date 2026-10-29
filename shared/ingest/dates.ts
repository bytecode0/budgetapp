// Dates as written by banks → calendar day "yyyy-mm-dd". Pure; runs in Node
// and browser. No Date object survives this module: a statement line belongs
// to a day, and converting through a timezone can move it to the previous one.
import type { DateOrder } from "./types.js";

const pad = (n: number) => String(n).padStart(2, "0");

/** "yyyy-mm-dd" if y/m/d is a real calendar day, else null. */
export function makeDay(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel's serial day number (1900 system: day 1 = 1900-01-01, with Excel's
 *  fictitious 1900-02-29) → calendar day. The time fraction is dropped. */
export function excelSerialToDay(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const whole = Math.floor(serial);
  // Serial 60 is the non-existent 1900-02-29; from 61 on, epoch 1899-12-30 is exact.
  const ms = Date.UTC(1899, 11, whole > 60 ? 30 : 31) + whole * 86400000;
  const dt = new Date(ms);
  return makeDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * Parses a date cell. Accepts: Excel serials (numbers in a plausible range),
 * ISO "yyyy-mm-dd" (with or without time, as Revolut writes it),
 * "yyyymmdd" (OFX), and day/month/year text with / - . separators and 2- or
 * 4-digit years in the given order (default dmy). A JS Date (some readers
 * produce one) is read by its LOCAL calendar fields, which is how it was built.
 */
export function parseDay(raw: unknown, order: DateOrder = "dmy"): string | null {
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : makeDay(raw.getFullYear(), raw.getMonth() + 1, raw.getDate());
  }
  if (typeof raw === "number") return raw > 20000 && raw < 80000 ? excelSerialToDay(raw) : null;
  const s = String(raw ?? "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/);
  if (m) return makeDay(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:$|[T\s\d[])/);
  if (m) return makeDay(Number(m[1]), Number(m[2]), Number(m[3]));

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|[T\s])/);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])];
    if (order === "mdy") return makeDay(y, a, b);
    return makeDay(y, b, a); // dmy (and ymd can't start with a 1-2 digit field)
  }

  // A number stored as text ("46300") in an xlsx date column.
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDay(Number(s), order);
  return null;
}
