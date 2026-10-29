// Bank profiles against their anonymised fixtures (fixtures/makeFixtures.ts:
// the BBVA one copies the real export's layout with invented data; the
// Revolut one is synthetic).
// Run with:  node --import tsx --test server/lib/ingest/profiles.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as XLSX from "xlsx";
import { readStatement } from "./read.js";
import { buildBbva, REVOLUT_CSV } from "./fixtures/makeFixtures.js";
import { classifyRows, type ClassifyAccount } from "./classify.js";

// The fixtures are built from their (invented) source on every run instead of
// being committed: *.xlsx and *.csv stay gitignored, so a real statement can
// never slip into the repo next to them.
const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FIXTURES: Record<string, Uint8Array> = {
  "bbva-cuenta.xlsx": new Uint8Array(XLSX.write(buildBbva(), { type: "array", bookType: "xlsx" }) as ArrayBuffer),
  "revolut-cuenta.csv": new TextEncoder().encode(REVOLUT_CSV),
};
const fixture = (name: string) => FIXTURES[name];

const checking: ClassifyAccount = { id: "acc-bbva", type: "checking", currency: "EUR", cardDebtId: null };

// What the pre-epic-4 importer (parsers/bbva.ts + importStatement.ts, removed)
// produced for this very file, captured before it was replaced.
interface LegacyRow {
  date: string; amountCents: number; description: string; merchant: string;
  balanceCents: number | null; kind: "expense" | "income"; legacyExternalId: string;
}
const legacy: LegacyRow[] = JSON.parse(readFileSync(join(fixtures, "bbva-cuenta.legacy-expected.json"), "utf8"));

test("bbva: the real export's layout is recognised (title rows, header on row 5, column A empty)", () => {
  const r = readStatement(fixture("bbva-cuenta.xlsx"), "Últimos movimientos.xlsx");
  assert.equal(r.source, "bbva");
  assert.equal(r.rows.length, 25);
  assert.equal(r.skipped.length, 0);
  // Fecha (operation date) wins over F.Valor where they differ.
  assert.equal(r.rows[0].date, "2026-09-30");
  // Movimiento / Observaciones kept as details, repeats dropped.
  const comision = r.rows.find(x => x.description.startsWith("Liquidacion de intereses"))!;
  assert.equal(comision.details, "Comision mantenimiento");
});

test("bbva regression: same rows, kinds, merchants and ids as the old importer", () => {
  const r = readStatement(fixture("bbva-cuenta.xlsx"), "Últimos movimientos.xlsx");
  const planned = classifyRows({ rows: r.rows, account: checking, debts: [], existing: [] }).rows;
  assert.equal(planned.length, legacy.length);
  planned.forEach((p, i) => {
    const old = legacy[i];
    assert.deepEqual(
      [p.date, p.signedCents, p.description, p.merchant, p.kind, p.legacyExternalId],
      [old.date, old.amountCents, old.description, old.merchant, old.kind, old.legacyExternalId],
      `row ${i}`,
    );
  });
  // A file imported with the old importer is recognised in full: nothing new.
  const existing = legacy.map((old, i) => ({
    id: `old-${i}`, table: old.kind, externalId: old.legacyExternalId, accountId: null, debtId: null,
    kind: old.kind, amountCents: Math.abs(old.amountCents), date: old.date, description: old.description, source: "import",
  }));
  const again = classifyRows({ rows: r.rows, account: checking, debts: [], existing }).rows;
  assert.equal(again.filter(p => p.status === "new").length, 0);
});

test("bbva: the two identical same-day coffees are two movements", () => {
  const r = readStatement(fixture("bbva-cuenta.xlsx"), "x.xlsx");
  const coffees = classifyRows({ rows: r.rows, account: checking, debts: [], existing: [] }).rows
    .filter(p => p.description === "Cafeteria imaginaria");
  assert.equal(coffees.length, 2);
  assert.notEqual(coffees[0].externalId, coffees[1].externalId);
});

test("revolut: states, fee rows, other currency flagged", () => {
  const r = readStatement(fixture("revolut-cuenta.csv"), "account-statement.csv");
  assert.equal(r.source, "revolut");
  assert.deepEqual(r.skipped.map(s => s.reason), ["state:PENDING", "state:REVERTED", "state:DECLINED"]);
  assert.equal(r.rows.length, 10);
  assert.deepEqual(r.rows[0], {
    rowIndex: 0, date: "2026-09-01", amountCents: 50000, description: "Top-up from example bank", details: undefined,
    balanceCents: 50000, currency: "EUR", state: "COMPLETED", feeCents: null,
  });
  const store = r.rows.find(x => x.description === "Online Store Demo, Ltd")!;
  assert.equal(store.amountCents, -12000);

  const planned = classifyRows({ rows: r.rows, account: { ...checking, id: "acc-rev" }, debts: [], existing: [] }).rows;
  // ATM withdrawal 60.00 + fee 1.20 → two expense rows; the exchange fee too.
  const atm = planned.filter(p => p.description === "Cash withdrawal example");
  assert.deepEqual(atm.map(p => [p.kind, p.amountCents, p.isFee]), [["expense", 6000, false], ["expense", 120, true]]);
  assert.equal(planned.filter(p => p.isFee).length, 2);
  // The USD leg of the exchange is flagged, not converted.
  const usd = planned.find(p => p.description === "Exchanged from EUR")!;
  assert.deepEqual(usd.warnings, ["currency_mismatch"]);
  // A card refund into a bank account is income (§4.1: bank credit → income).
  assert.equal(planned.find(p => p.signedCents === 3000)!.kind, "income");
  // Re-importing the same export (with the pending row now completed) only adds that row.
  const existing = planned.map((p, i) => ({
    id: `e${i}`, table: p.kind === "income" ? "income" as const : "expense" as const, externalId: p.externalId,
    accountId: "acc-rev", debtId: null, kind: p.kind === "income" ? "income" : "expense",
    amountCents: p.amountCents, date: p.date, description: p.description, source: "import",
  }));
  const later = new TextDecoder().decode(fixture("revolut-cuenta.csv"))
    .replace("2026-09-16 20:00:00,,Pending Restaurant Example,-35.00,0.00,EUR,PENDING,",
      "2026-09-16 20:00:00,2026-09-17 09:00:00,Pending Restaurant Example,-35.00,0.00,EUR,COMPLETED,134.25");
  const r2 = readStatement(new TextEncoder().encode(later), "account-statement.csv");
  const again = classifyRows({ rows: r2.rows, account: { ...checking, id: "acc-rev" }, debts: [], existing }).rows;
  assert.deepEqual(again.filter(p => p.status === "new").map(p => p.description), ["Pending Restaurant Example"]);
});

test("fixtures carry no real data markers (IBAN, card numbers, DNI)", () => {
  const texts = [
    new TextDecoder().decode(fixture("revolut-cuenta.csv")),
    readFileSync(join(fixtures, "bbva-cuenta.legacy-expected.json"), "utf8"),
    JSON.stringify(readStatement(fixture("bbva-cuenta.xlsx"), "x.xlsx").rows),
  ];
  for (const t of texts) {
    assert.doesNotMatch(t, /\bES\d{2}[\s\d]{20,}/i, "IBAN");
    assert.doesNotMatch(t, /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/, "card number");
    assert.doesNotMatch(t, /\b\d{8}[A-Z]\b/, "DNI");
  }
});
