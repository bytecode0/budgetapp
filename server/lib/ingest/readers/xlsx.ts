// XLSX/XLS → one grid per sheet. Uses the `xlsx` package, which runs in Node
// and in the browser alike; it gets a Uint8Array, never a Node Buffer API.
//
// Cells come back RAW: numbers stay numbers (amounts are then exact to the
// cent via parseAmountCents) and date cells stay Excel serials, turned into a
// calendar day by parseDay — no Date object, so no timezone shift. Which sheet
// holds the movements is decided by the column detection (read.ts), which
// tries every sheet.
import * as XLSX from "xlsx";

export interface Sheet {
  name: string;
  grid: unknown[][];
}

export function readWorkbook(bytes: Uint8Array): Sheet[] {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map(name => ({
    name,
    grid: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "", blankrows: false }) as unknown[][],
  }));
}

/** XLSX (zip: "PK") or legacy XLS (OLE2: D0 CF 11 E0). */
export function looksLikeWorkbook(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x50 && bytes[1] === 0x4b)
    || (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0);
}
