// Run with:  node --import tsx --test server/lib/cardDebt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardDebtOwnershipChanges } from "./cardDebt.js";

test("a card's new owner becomes its debt's owner", () => {
  assert.deepEqual(cardDebtOwnershipChanges("card", { ownerUserId: "ben" }), { ownerUserId: "ben" });
});

test("a card's visibility change carries over to its debt", () => {
  assert.deepEqual(cardDebtOwnershipChanges("card", { visibility: "private" }), { visibility: "private" });
  assert.deepEqual(
    cardDebtOwnershipChanges("card", { ownerUserId: "ben", visibility: "household" }),
    { ownerUserId: "ben", visibility: "household" },
  );
});

test("edits that don't touch ownership leave the debt alone", () => {
  assert.equal(cardDebtOwnershipChanges("card", {}), null);
  assert.equal(cardDebtOwnershipChanges("card", { ownerUserId: undefined, visibility: undefined }), null);
});

test("an account that is no longer a card mirrors nothing (its debt is dropped)", () => {
  assert.equal(cardDebtOwnershipChanges("checking", { ownerUserId: "ben", visibility: "private" }), null);
});
