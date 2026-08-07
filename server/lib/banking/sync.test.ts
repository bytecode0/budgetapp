// Run with:  npx tsx --test server/lib/banking/sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { externalIdForProviderTxn, mapProviderTxn } from "./sync.js";
import type { BankProviderTxn } from "./types.js";

test("externalIdForProviderTxn namespaces by provider, never colliding across providers", () => {
  assert.equal(externalIdForProviderTxn("gocardless", "abc123"), "gocardless:abc123");
  assert.notEqual(externalIdForProviderTxn("gocardless", "abc123"), externalIdForProviderTxn("plaid", "abc123"));
});

test("externalIdForProviderTxn never collides with the manual file-import content-hash format", () => {
  // The manual pipeline's externalIdFor() produces a 32-char hex hash with no
  // colon — this format is namespaced and can never look like that by accident.
  const id = externalIdForProviderTxn("gocardless", "tx-1");
  assert.match(id, /^gocardless:/);
  assert.doesNotMatch(id, /^[0-9a-f]{32}$/);
});

test("mapProviderTxn maps a debit to an expense with the correct sign/amount split", () => {
  const txn: BankProviderTxn = { id: "tx-1", date: "2026-08-15", description: "MERCADONA MADRID", amount: -45.5, currency: "EUR" };
  const row = mapProviderTxn(txn, "gocardless");
  assert.equal(row.kind, "expense");
  assert.equal(row.amount, 45.5);
  assert.equal(row.signedAmount, -45.5);
  assert.equal(row.externalId, "gocardless:tx-1");
  assert.equal(row.date, "2026-08-15");
});

test("mapProviderTxn maps a credit to income", () => {
  const txn: BankProviderTxn = { id: "tx-2", date: "2026-08-25", description: "NOMINA EMPRESA SL", amount: 2200, currency: "EUR" };
  const row = mapProviderTxn(txn, "gocardless");
  assert.equal(row.kind, "income");
  assert.equal(row.amount, 2200);
  assert.equal(row.signedAmount, 2200);
});

test("mapProviderTxn normalizes the merchant the same way the manual import path does", () => {
  const txn: BankProviderTxn = { id: "tx-3", date: "2026-08-10", description: "MERCADONA SA 1234", amount: -20, currency: "EUR" };
  const row = mapProviderTxn(txn, "gocardless");
  assert.equal(row.merchant, "mercadona"); // matches normalizeMerchant's own test expectations
});

test("mapProviderTxn output has no status/suggestion fields — those require a DB round-trip", () => {
  const txn: BankProviderTxn = { id: "tx-4", date: "2026-08-01", description: "TEST", amount: -1, currency: "EUR" };
  const row = mapProviderTxn(txn, "gocardless");
  assert.equal("status" in row, false);
  assert.equal("suggestedAllocationId" in row, false);
});
