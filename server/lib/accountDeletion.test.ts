// Run with:  node --import tsx --test server/lib/accountDeletion.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DELETION_GRACE_MS, clashRenames, deletionDueAt, isDeletionDue, isLockNotAvailable, pairAction, purgeCutoff } from "./accountDeletion.js";

const T0 = new Date("2026-11-04T10:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

test("the grace period is 24 hours", () => {
  assert.equal(DELETION_GRACE_MS, 86_400_000);
  assert.deepEqual(deletionDueAt(T0), new Date("2026-11-05T10:00:00Z"));
  assert.deepEqual(purgeCutoff(at(DELETION_GRACE_MS)), T0);
});

test("a request is due only once 24 hours have passed", () => {
  assert.equal(isDeletionDue(T0, at(DELETION_GRACE_MS - 1)), false);
  assert.equal(isDeletionDue(T0, at(DELETION_GRACE_MS)), true);
  assert.equal(isDeletionDue(T0, at(2 * DELETION_GRACE_MS)), true);
});

test("no request (or a cancelled one) is never due", () => {
  assert.equal(isDeletionDue(null, at(10 * DELETION_GRACE_MS)), false);
});

test("pairAction: the survivor's end of a cross-owner pair always stays consistent", () => {
  // D's debt on the survivor's card: a card's debt belongs to the card's owner.
  assert.equal(pairAction({ debtOwner: "D", accountOwner: "S", accountType: "card" }, "D"), "reown_debt");
  assert.equal(pairAction({ debtOwner: "D", accountOwner: "S", accountType: "checking" }, "D"), "delete_debt");
  assert.equal(pairAction({ debtOwner: "S", accountOwner: "D", accountType: "card" }, "D"), "freeze_debt");
  assert.equal(pairAction({ debtOwner: "S", accountOwner: "S", accountType: "card" }, "D"), null);
  assert.equal(pairAction({ debtOwner: "S", accountOwner: "T", accountType: "card" }, "D"), null);
});

test("clashRenames namespaces only the pool rows whose externalId she already has", () => {
  const out = clashRenames("owner", [{ externalId: "a" }, { externalId: null }], [
    { id: "1", externalId: "a" }, { id: "2", externalId: "b" }, { id: "3", externalId: null },
  ]);
  assert.deepEqual(out, [{ id: "1", externalId: "merged:owner:a" }]);
});

test("isLockNotAvailable recognises Postgres 55P03 from a raw query", () => {
  assert.equal(isLockNotAvailable({ code: "P2010", meta: { code: "55P03" } }), true);
  assert.equal(isLockNotAvailable(new Error("could not obtain lock on row in relation \"User\"")), true);
  assert.equal(isLockNotAvailable(new Error("boom")), false);
  assert.equal(isLockNotAvailable(null), false);
});
