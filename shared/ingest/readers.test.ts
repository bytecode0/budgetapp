// Run with:  node --import tsx --test shared/ingest/readers.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { detectDecimal, parseAmountCents } from "./numbers.js";
import { excelSerialToDay, parseDay } from "./dates.js";
import { decodeText, detectEncoding } from "./text.js";
import { detectDelimiter, parseCsv, readCsv } from "./readers/csv.js";
import { readWorkbook } from "./readers/xlsx.js";
import { looksLikeNorma43, readNorma43 } from "./readers/norma43.js";
import { looksLikeOfx, readOfx } from "./readers/ofx.js";
import { MAX_STATEMENT_ROWS, MAX_WORKBOOK_BYTES, readStatement, sampleStatement, StatementReadError } from "./read.js";

// ── Numbers ────────────────────────────────────────────────────────────────

test("amounts: Spanish, English and ambiguous formats to exact cents", () => {
  const cases: [unknown, number][] = [
    ["1.234,56", 123456], ["1,234.56", 123456], ["-12,34", -1234], ["12.34", 1234],
    ["1.234", 123400], ["1,234", 123400], ["1.234.567", 123456700], ["1,234,567.8", 123456780],
    ["(12.34)", -1234], ["12,34-", -1234], ["+5", 500], ["0,1", 10], ["0", 0],
    ["€ 1.234,56", 123456], ["-12.50 EUR", -1250], ["1 234,56", 123456], ["1 234,56", 123456],
    ["1'234.56", 123456], ["$-3.10", -310], ["12,345", 1234500],
    [-2.35, -235], [2208.48, 220848], [1e3, 100000],
  ];
  for (const [raw, cents] of cases) assert.equal(parseAmountCents(raw), cents, String(raw));
});

test("amounts: a known decimal separator settles one separator + three digits", () => {
  assert.equal(parseAmountCents("1.234", "."), 123);     // 1.234 → 1,23 (third decimal rounds)
  assert.equal(parseAmountCents("1,235", ","), 124);
  assert.equal(parseAmountCents("1.234", ","), 123400);  // "," is decimal → "." is thousands
});

test("amounts: not a number → null", () => {
  for (const raw of ["", "  ", "abc", "-", "1.2.3,4,5x", null, undefined, NaN, "12/09/2026"]) {
    assert.equal(parseAmountCents(raw), null, String(raw));
  }
});

test("detectDecimal reads the column, not one cell", () => {
  assert.equal(detectDecimal(["-12,34", "1.234", "5"]), ",");
  assert.equal(detectDecimal(["-12.34", "1,234", "5"]), ".");
  assert.equal(detectDecimal(["1.234,56"]), ",");
  assert.equal(detectDecimal(["1.234", "5"]), null);
});

// ── Dates ──────────────────────────────────────────────────────────────────

test("dates: dd/mm/yyyy, dd-mm-yy, ISO, Excel serials, OFX", () => {
  const cases: [unknown, string | null][] = [
    ["29/10/2026", "2026-10-29"], ["1/9/2026", "2026-09-01"], ["29-10-26", "2026-10-29"], ["29.10.2026", "2026-10-29"],
    ["2026-10-29", "2026-10-29"], ["2026-10-29 13:45:00", "2026-10-29"], ["2026-10-29T23:59:59Z", "2026-10-29"],
    ["20261029", "2026-10-29"], ["20261029120000[-5:EST]", "2026-10-29"],
    [46324, "2026-10-29"], [46324.75, "2026-10-29"], ["46324", "2026-10-29"],
    ["31/02/2026", null], ["13/13/2026", null], ["", null], ["fecha", null], [12, null],
  ];
  for (const [raw, day] of cases) assert.equal(parseDay(raw), day, String(raw));
});

test("dates: month-first when the mapping says so", () => {
  assert.equal(parseDay("10/29/2026", "mdy"), "2026-10-29");
  assert.equal(parseDay("10/29/2026"), null); // dmy: month 29 doesn't exist
});

test("dates: Excel serial edges (1900 leap bug)", () => {
  assert.equal(excelSerialToDay(1), "1900-01-01");
  assert.equal(excelSerialToDay(59), "1900-02-28");
  assert.equal(excelSerialToDay(61), "1900-03-01");
  assert.equal(excelSerialToDay(45658), "2025-01-01");
});

// ── Text encodings ─────────────────────────────────────────────────────────

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => Array.from(s, c => c.charCodeAt(0));

test("encoding: UTF-8 with and without BOM", () => {
  const utf8 = new TextEncoder().encode("Fecha;Concepto\n01/09/2026;Cañas €");
  assert.equal(decodeText(utf8).text, "Fecha;Concepto\n01/09/2026;Cañas €");
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
  assert.equal(decodeText(withBom).text.startsWith("Fecha"), true);
});

test("encoding: Latin-1 / Windows-1252 (ñ, á, € as 0x80)", () => {
  const latin = bytes(...ascii("Ca"), 0xf1, ...ascii("as "), 0x80, ...ascii(" caf"), 0xe9);
  assert.equal(detectEncoding(latin), "windows-1252");
  assert.equal(decodeText(latin).text, "Cañas € café");
});

test("encoding: UTF-16 LE/BE with BOM, and LE without BOM", () => {
  const le = (s: string) => Array.from(s).flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]);
  const be = (s: string) => Array.from(s).flatMap(c => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff]);
  assert.equal(decodeText(bytes(0xff, 0xfe, ...le("Año;Importe"))).text, "Año;Importe");
  assert.equal(decodeText(bytes(0xfe, 0xff, ...be("Año;Importe"))).text, "Año;Importe");
  const noBom = bytes(...le("Fecha;Importe\n01/09/2026;-1,00"));
  assert.equal(detectEncoding(noBom), "utf-16le");
  assert.equal(decodeText(noBom).text, "Fecha;Importe\n01/09/2026;-1,00");
});

// ── CSV ────────────────────────────────────────────────────────────────────

test("csv: quoted separators, escaped quotes and line breaks inside quotes", () => {
  const grid = parseCsv('a;b;c\n"x;y";"he said ""hi""";"line1\nline2"\r\n1;2;3', ";");
  assert.deepEqual(grid, [["a", "b", "c"], ["x;y", 'he said "hi"', "line1\nline2"], ["1", "2", "3"]]);
});

test("csv: delimiter detection — ; with decimal commas, , with quoted commas, tab", () => {
  const semi = "Movimientos de la cuenta\nFecha;Concepto;Importe\n01/09/2026;Compra, tienda;-12,34\n02/09/2026;Nómina;1.500,00\n";
  assert.equal(detectDelimiter(semi), ";");
  const comma = 'Date,Description,Amount\n2026-09-01,"Shop, Ltd",-12.34\n2026-09-02,Salary,1500.00\n';
  assert.equal(detectDelimiter(comma), ",");
  assert.equal(detectDelimiter("Fecha\tConcepto\tImporte\n01/09/2026\tCompra\t-1,00\n"), "\t");
  assert.deepEqual(readCsv(comma)[1], ["2026-09-01", "Shop, Ltd", "-12.34"]);
});

test("csv end to end: Latin-1 bytes, ; separator, Spanish header → rows", () => {
  const text = "Fecha;Concepto;Importe;Saldo\n01/09/2026;Panadería;-2,35;100,00\n02/09/2026;Devolución;1.234,56;1.334,56\n";
  const latin = new Uint8Array(Array.from(text, c => c.charCodeAt(0)));
  const r = readStatement(latin, "movs.csv");
  assert.equal(r.source, "generic");
  assert.deepEqual(r.rows.map(x => [x.date, x.description, x.amountCents, x.balanceCents]), [
    ["2026-09-01", "Panadería", -235, 10000],
    ["2026-09-02", "Devolución", 123456, 133456],
  ]);
});

test("csv: separate debit / credit columns", () => {
  const csv = "Date,Description,Money out,Money in\n2026-09-01,Shop,12.50,\n2026-09-02,Salary,,1500.00\n";
  const r = readStatement(new TextEncoder().encode(csv), "x.csv");
  assert.deepEqual(r.rows.map(x => x.amountCents), [-1250, 150000]);
});

test("unrecognised columns → StatementReadError with a sample for the mapping UI", () => {
  const csv = "Col A;Col B\nfoo;bar\n";
  assert.throws(() => readStatement(new TextEncoder().encode(csv), "x.csv"), (e: unknown) =>
    e instanceof StatementReadError && e.code === "unrecognized_columns" && e.sample?.[0].rows[0][0] === "Col A");
});

test("a saved mapping reads a file no profile knows, and states the card sign", () => {
  const csv = "Día;Qué;Cuánto\n29/10/2026;Algo;12,50\n";
  const r = readStatement(new TextEncoder().encode(csv), "x.csv", {
    mapping: { date: "Día", amount: "Cuánto", description: ["Qué"], purchasesSign: "positive" },
  });
  assert.equal(r.source, "mapping");
  assert.equal(r.purchasesSign, "positive");
  assert.deepEqual(r.rows.map(x => [x.date, x.description, x.amountCents]), [["2026-10-29", "Algo", 1250]]);
});

// ── XLSX ───────────────────────────────────────────────────────────────────

test("xlsx: picks the sheet with the movements, keeps numbers and serial dates exact", () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Resumen"], ["Titular", "Ejemplo"]]), "Resumen");
  const ws = XLSX.utils.aoa_to_sheet([
    ["Extracto"], [],
    ["Fecha", "Concepto", "Importe"],
    [46324, "Compra", -0.1], // a real date cell: Excel serial for 29/10/2026
    ["30/10/2026", "Otra", -1234.5],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const sheets = readWorkbook(new Uint8Array(data));
  assert.equal(sheets.length, 2);
  const r = readStatement(new Uint8Array(data), "x.xlsx");
  assert.deepEqual(r.rows.map(x => [x.date, x.description, x.amountCents]), [
    ["2026-10-29", "Compra", -10],
    ["2026-10-30", "Otra", -123450],
  ]);
});

// ── Norma 43 ───────────────────────────────────────────────────────────────

const n43 = (...fields: string[]) => fields.join("").padEnd(80, " ");
// 11: bank 0182, branch 1234, account 0011223344, 01/09/26–30/09/26, opening +1.000,00 EUR
const N43 = [
  n43("11", "0182", "1234", "0011223344", "260901", "260930", "2", "00000000100000", "978", "3", "CUENTA EJEMPLO"),
  n43("22", "    ", "1234", "260902", "260902", "12", "001", "1", "00000000004237", "0000000000", "000000000000", "REF EJEMPLO"),
  n43("23", "01", "SUPERMERCADO DEMO CENTRO".padEnd(38), "COMPRA TARJETA"),
  n43("22", "    ", "1234", "260905", "260905", "02", "002", "2", "00000000185000", "0000000000", "000000000000", ""),
  n43("23", "01", "NOMINA EMPRESA EJEMPLO"),
  n43("22", "    ", "1234", "260906", "260906", "17", "003", "1", "00000000000450", "0000000000", "000000000000", ""),
  n43("33", "0182", "1234", "0011223344", "00002", "00000000004687", "00001", "00000000185000", "2", "00000000280313", "978"),
  n43("88", "999999999999999999", "000007"),
].join("\r\n");

test("norma 43: movements, signs, concepts, derived running balance", () => {
  assert.equal(looksLikeNorma43(N43), true);
  const r = readNorma43(N43);
  assert.equal(r.currency, "EUR");
  assert.deepEqual(r.rows.map(x => [x.date, x.amountCents, x.description, x.balanceCents]), [
    ["2026-09-02", -4237, "SUPERMERCADO DEMO CENTRO", 95763],
    ["2026-09-05", 185000, "NOMINA EMPRESA EJEMPLO", 280763],
    ["2026-09-06", -450, "Intereses - comisiones - custodia - gastos e impuestos", 280313],
  ]);
  assert.equal(r.rows[0].details, "COMPRA TARJETA");
  // Read through the generic entry point, even with a .txt name.
  assert.equal(readStatement(new TextEncoder().encode(N43), "extracto.txt").source, "norma43");
});

// ── OFX ────────────────────────────────────────────────────────────────────

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>EUR
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260902120000[-5:EST]<TRNAMT>-42.37<FITID>A001<NAME>SUPERMERCADO DEMO<MEMO>Compra</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260920<TRNAMT>150.00<FITID>A002<NAME>PAGO RECIBIDO &amp; GRACIAS</STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

test("ofx: SGML card statement — dates, signed amounts, FITID, entities", () => {
  assert.equal(looksLikeOfx(OFX_SGML), true);
  const r = readOfx(OFX_SGML);
  assert.equal(r.isCreditCard, true);
  assert.equal(r.currency, "EUR");
  assert.deepEqual(r.rows.map(x => [x.date, x.amountCents, x.externalRef, x.description]), [
    ["2026-09-02", -4237, "A001", "SUPERMERCADO DEMO"],
    ["2026-09-20", 15000, "A002", "PAGO RECIBIDO & GRACIAS"],
  ]);
});

test("ofx: XML (2.x) bank statement", () => {
  const xml = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR</CURDEF><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260903</DTPOSTED><TRNAMT>-15.00</TRNAMT><FITID>X1</FITID><NAME>Bizum</NAME><MEMO>Cena</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const r = readStatement(new TextEncoder().encode(xml), "x.qfx");
  assert.equal(r.source, "ofx");
  assert.deepEqual(r.rows.map(x => [x.date, x.amountCents, x.externalRef, x.description, x.details]), [
    ["2026-09-03", -1500, "X1", "Bizum", "Cena"],
  ]);
});

test("sign convention: OFX and Norma 43 are holder's view; split debit/credit columns too; one amount column isn't", () => {
  const enc = (t: string) => new TextEncoder().encode(t);
  assert.equal(readStatement(enc(OFX_SGML), "x.ofx").purchasesSign, "negative");
  assert.equal(readStatement(enc(N43), "x.txt").purchasesSign, "negative");
  const split = readStatement(enc("Fecha;Concepto;Cargos;Abonos\n03/10/2026;SUPER;12,50;\n05/10/2026;PAGO;;100,00\n"), "x.csv");
  assert.equal(split.purchasesSign, "negative");
  assert.deepEqual(split.rows.map(r => r.amountCents), [-1250, 10000]);
  const single = readStatement(enc("Fecha;Concepto;Importe\n03/10/2026;SUPER;12,50\n"), "x.csv");
  assert.equal(single.purchasesSign, undefined);
});

test("limits: more than MAX_STATEMENT_ROWS movements, or a huge workbook, is refused with a code", () => {
  const lines = ["Fecha;Concepto;Importe", ...Array.from({ length: MAX_STATEMENT_ROWS + 1 }, (_, i) => `03/10/2026;SHOP ${i};-1,00`)];
  assert.throws(() => readStatement(new TextEncoder().encode(lines.join("\n")), "x.csv"),
    (e: unknown) => e instanceof StatementReadError && e.code === "too_many_rows");
  const ok = ["Fecha;Concepto;Importe", ...Array.from({ length: MAX_STATEMENT_ROWS }, (_, i) => `03/10/2026;SHOP ${i};-1,00`)];
  assert.equal(readStatement(new TextEncoder().encode(ok.join("\n")), "x.csv").rows.length, MAX_STATEMENT_ROWS);
  const zip = new Uint8Array(MAX_WORKBOOK_BYTES + 1);
  zip[0] = 0x50; zip[1] = 0x4b;
  assert.throws(() => readStatement(zip, "x.xlsx"), (e: unknown) => e instanceof StatementReadError && e.code === "file_too_large");
});

test("sample for the manual mapping: tabular files only, first rows as text", () => {
  const csv = new TextEncoder().encode("Día;Qué;Cuánto\n15/09/2026;Algo;-12,50\n");
  assert.deepEqual(sampleStatement(csv), [{ sheet: "", rows: [["Día", "Qué", "Cuánto"], ["15/09/2026", "Algo", "-12,50"]] }]);
  const ofx = new TextEncoder().encode("OFXHEADER:100\n<OFX></OFX>");
  assert.equal(sampleStatement(ofx), null);
  assert.equal(sampleStatement(new Uint8Array()), null);
});
