// Builds the statement fixtures used by the ingest tests (profiles.test.ts
// builds them in memory). To look at them in Excel, write them out with:
//   node --import tsx server/lib/ingest/fixtures/makeFixtures.ts
// (*.xlsx / *.csv are gitignored on purpose: real statements must never be
// committed, so the fixtures live as this source instead.)
//
// EVERYTHING here is invented: descriptions, amounts, dates and balances. The
// BBVA file only copies the LAYOUT of a real "Últimos movimientos" export
// (sheet name, empty column A, title rows merged over D:G, header on row 5,
// dates as dd/mm/yyyy text, amounts and balances as numbers, newest first) so
// the reader is tested against the shape the bank really ships. Never put a
// real export, name, IBAN, merchant reference or amount in this folder.
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// ── BBVA (cuenta) ──────────────────────────────────────────────────────────
// Oldest first; [fecha, fValor (if different), concepto, movimiento, importe cents, observaciones]
type BbvaRow = [string, string | null, string, string, number, string];
const BBVA_ROWS: BbvaRow[] = [
  ["01/09/2026", null, "Abono de nómina", "Nomina empresa ejemplo", 185000, "NOMINA EMPRESA EJEMPLO"],
  ["01/09/2026", null, "Transferencia realizada", "Alquiler piso ejemplo", -75000, "ALQUILER PISO EJEMPLO"],
  ["02/09/2026", null, "Supermercado demo centro", "Pago con tarjeta", -4237, "PAGO CON TARJETA"],
  ["03/09/2026", null, "Bizum", "Enviado: cena amigos", -1500, "ENVIADO: CENA AMIGOS"],
  ["03/09/2026", null, "Bizum", "Recibido: entradas concierto", 2250, "RECIBIDO: ENTRADAS CONCIERTO"],
  ["05/09/2026", null, "Gasolinera ficticia km 12", "Pago con tarjeta", -6000, "PAGO CON TARJETA"],
  ["06/09/2026", null, "Cafeteria imaginaria", "Pago con tarjeta", -380, "PAGO CON TARJETA"],
  ["06/09/2026", null, "Cafeteria imaginaria", "Pago con tarjeta", -380, "PAGO CON TARJETA"],
  ["08/09/2026", null, "Adeudo compañia luz ficticia", "Recibo luz septiembre", -6412, "RECIBO LUZ SEPTIEMBRE"],
  ["09/09/2026", null, "Plataforma video demo", "Suscripcion mensual", -1299, "SUSCRIPCION MENSUAL"],
  ["10/09/2026", null, "Transferencia recibida", "Devolucion gastos compartidos", 3500, "DEVOLUCION GASTOS COMPARTIDOS"],
  ["12/09/2026", "10/09/2026", "Liquidacion de intereses-comisiones-gastos", "Comision mantenimiento", -450, "COMISION MANTENIMIENTO"],
  ["13/09/2026", null, "Tienda ropa ejemplo", "Pago con tarjeta", -2995, "PAGO CON TARJETA"],
  ["15/09/2026", null, "Bizum", "Enviado: regalo cumpleaños", -2000, "ENVIADO: REGALO CUMPLEAÑOS"],
  ["15/09/2026", null, "Transferencia realizada", "Traspaso a ahorro", -120000, "TRASPASO A AHORRO"],
  ["17/09/2026", null, "Farmacia ejemplo", "Pago con tarjeta", -845, "PAGO CON TARJETA"],
  ["18/09/2026", null, "Ingreso en efectivo", "", 10000, ""],
  ["20/09/2026", null, "Pago tarjeta de credito ficticia", "Liquidacion tarjeta", -15000, "LIQUIDACION TARJETA"],
  ["21/09/2026", null, "Gimnasio ficticio", "Cuota mensual", -3990, "CUOTA MENSUAL"],
  ["22/09/2026", null, "Supermercado demo centro", "Pago con tarjeta", -5710, "PAGO CON TARJETA"],
  ["24/09/2026", null, "Abono bonificación ejemplo", "Bonificacion", 500, "BONIFICACION"],
  ["25/09/2026", null, "Bizum", "Recibido: parte loteria", 1000, "RECIBIDO: PARTE LOTERIA"],
  ["27/09/2026", null, "Restaurante inventado", "Pago con tarjeta", -4860, "PAGO CON TARJETA"],
  ["29/09/2026", null, "Transferencia realizada", "Pago comunidad ejemplo", -4500, "PAGO COMUNIDAD EJEMPLO"],
  ["30/09/2026", "29/09/2026", "Panaderia de prueba", "Pago con tarjeta", -235, "PAGO CON TARJETA"],
];
const BBVA_OPENING_CENTS = 152033;

export function buildBbva(): XLSX.WorkBook {
  let balance = BBVA_OPENING_CENTS;
  const data = BBVA_ROWS.map(([fecha, fValor, concepto, movimiento, cents, obs]) => {
    balance += cents;
    return [fValor ?? fecha, fecha, concepto, movimiento, cents / 100, "EUR", balance / 100, "EUR", obs];
  }).reverse(); // BBVA lists newest first

  const aoa: unknown[][] = [
    [],
    [null, null, "Últimos movimientos"],
    [null, null, "Fecha de generación del informe: 01/10/2026"],
    [],
    ["F.Valor", "Fecha", "Concepto", "Movimiento", "Importe", "Divisa", "Disponible", "Divisa", "Observaciones"],
    ...data,
  ];
  // Column A is empty in the real export: the table starts at B1.
  const ws = XLSX.utils.aoa_to_sheet(aoa.map(r => [null, ...r]));
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 1 }, e: { r: aoa.length - 1, c: 9 } });
  ws["!merges"] = [
    { s: { r: 1, c: 3 }, e: { r: 1, c: 6 } },
    { s: { r: 2, c: 3 }, e: { r: 2, c: 6 } },
  ];
  ws["!cols"] = [5, 15, 15, 45, 45, 20, 10, 20, 10, 45].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Informe BBVA");
  return wb;
}

// ── Revolut (cuenta) ───────────────────────────────────────────────────────
// Synthetic, following Revolut's public CSV export columns. English number
// format, fee in its own column, per-row state, balance per currency.
export const REVOLUT_CSV = [
  "Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance",
  "TOPUP,Current,2026-09-01 08:00:00,2026-09-01 08:00:05,Top-up from example bank,500.00,0.00,EUR,COMPLETED,500.00",
  "CARD_PAYMENT,Current,2026-09-02 13:10:11,2026-09-03 09:00:00,Demo Supermarket,-23.45,0.00,EUR,COMPLETED,476.55",
  "CARD_PAYMENT,Current,2026-09-04 09:15:00,2026-09-05 10:00:00,Coffee Example,-2.80,0.00,EUR,COMPLETED,473.75",
  "CARD_PAYMENT,Current,2026-09-04 17:40:00,2026-09-05 10:00:00,Coffee Example,-2.80,0.00,EUR,COMPLETED,470.95",
  "EXCHANGE,Current,2026-09-06 11:00:00,2026-09-06 11:00:00,Exchanged to USD,-100.00,0.50,EUR,COMPLETED,370.45",
  "EXCHANGE,Current,2026-09-06 11:00:00,2026-09-06 11:00:00,Exchanged from EUR,108.20,0.00,USD,COMPLETED,108.20",
  "TRANSFER,Current,2026-09-08 19:00:00,2026-09-08 19:00:02,Transfer to example savings,-50.00,0.00,EUR,COMPLETED,320.45",
  "CARD_PAYMENT,Current,2026-09-10 12:00:00,2026-09-11 08:00:00,\"Online Store Demo, Ltd\",-120.00,0.00,EUR,COMPLETED,200.45",
  "ATM,Current,2026-09-12 21:30:00,2026-09-12 21:30:10,Cash withdrawal example,-60.00,1.20,EUR,COMPLETED,139.25",
  "CARD_REFUND,Current,2026-09-14 10:00:00,2026-09-15 09:00:00,\"Online Store Demo, Ltd\",30.00,0.00,EUR,COMPLETED,169.25",
  "CARD_PAYMENT,Current,2026-09-16 20:00:00,,Pending Restaurant Example,-35.00,0.00,EUR,PENDING,",
  "CARD_PAYMENT,Current,2026-09-17 08:00:00,2026-09-18 08:00:00,Reverted Shop Example,-15.00,0.00,EUR,REVERTED,",
  "CARD_PAYMENT,Current,2026-09-18 08:00:00,,Declined Shop Example,-99.00,0.00,EUR,DECLINED,",
  "",
].join("\n");

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const wb = buildBbva();
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  writeFileSync(join(here, "bbva-cuenta.xlsx"), out);
  writeFileSync(join(here, "revolut-cuenta.csv"), REVOLUT_CSV);
  console.log("fixtures written to", here);
}
