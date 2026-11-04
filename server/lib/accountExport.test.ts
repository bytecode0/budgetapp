// Run with:  node --import tsx --test server/lib/accountExport.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToDecimal, csvCell, movementsCsv, ownershipFor, type MovementRow } from "./accountExport.js";
import type { UnlinkPlan } from "./partnerUnlink.js";

test("centsToDecimal formats integer cents without floating point", () => {
  assert.equal(centsToDecimal(0), "0.00");
  assert.equal(centsToDecimal(5), "0.05");
  assert.equal(centsToDecimal(1234), "12.34");
  assert.equal(centsToDecimal(-1234), "-12.34");
  assert.equal(centsToDecimal(-7), "-0.07");
  assert.equal(centsToDecimal(123456789), "1234567.89");
});

test("csvCell quotes separators and neutralises spreadsheet formulas", () => {
  assert.equal(csvCell("Mercadona"), "Mercadona");
  assert.equal(csvCell('Bar "Pepe", Madrid'), '"Bar ""Pepe"", Madrid"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("+34 600"), "'+34 600");
  assert.equal(csvCell("-12.34", { text: false }), "-12.34");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell("a\nb"), '"a\nb"');
});

const row = (over: Partial<MovementRow>): MovementRow => ({
  date: new Date("2026-10-02T00:00:00Z"), type: "expense", amount: 1050, currency: "EUR",
  description: "", merchant: "", category: "", account: "", debt: "", scope: "personal", source: "manual", ...over,
});

test("movementsCsv: BOM, header, oldest first, expenses negative", () => {
  const csv = movementsCsv([
    row({ date: new Date("2026-10-05T00:00:00Z"), type: "income", amount: 200000, description: "Nómina" }),
    row({ description: "Mercadona", category: "Comida" }),
    row({ date: new Date("2026-10-03T00:00:00Z"), type: "refund", amount: 300 }),
  ]);
  assert.ok(csv.startsWith("﻿date,type,amount,currency,"));
  const lines = csv.slice(1).trimEnd().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(lines[1], "2026-10-02,expense,-10.50,EUR,Mercadona,,Comida,,,personal,manual");
  assert.match(lines[2], /^2026-10-03,refund,3\.00,/);
  assert.match(lines[3], /^2026-10-05,income,2000\.00,EUR,Nómina,/);
});

function plan(move: Partial<UnlinkPlan["move"]>): UnlinkPlan {
  const empty = { accountIds: [], debtIds: [], bankConnectionIds: [], incomeIds: [], expenseIds: [], planIds: [], allocationIds: [], ruleIds: [] };
  return { move: { ...empty, ...move } } as unknown as UnlinkPlan;
}

test("ownershipFor: alone, everything in my scope is mine", () => {
  const own = ownershipFor("me", { kind: "solo" });
  assert.deepEqual(own.scopes, ["me"]);
  assert.equal(own.isMine("expenseIds", { id: "e1", userId: "me" }), true);
  assert.equal(own.isMine("expenseIds", { id: "e2", userId: "other" }), false);
});

test("ownershipFor: a member owns what the unlink would move to her, the owner the rest", () => {
  const p = plan({ expenseIds: ["hers"], accountIds: ["herAccount"] });
  const member = ownershipFor("her", { kind: "member", poolId: "pool", plan: p });
  const owner = ownershipFor("pool", { kind: "owner", plan: p });
  assert.deepEqual(member.scopes, ["her", "pool"]);
  assert.deepEqual(owner.scopes, ["pool"]);
  for (const [key, id] of [["expenseIds", "hers"], ["accountIds", "herAccount"]] as const) {
    assert.equal(member.isMine(key, { id, userId: "pool" }), true);
    assert.equal(owner.isMine(key, { id, userId: "pool" }), false);
  }
  assert.equal(member.isMine("expenseIds", { id: "his", userId: "pool" }), false);
  assert.equal(owner.isMine("expenseIds", { id: "his", userId: "pool" }), true);
});
