// Run with:  node --import tsx --test server/lib/defaultAccount.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDefaultAccount, type AccountChoice } from "./defaultAccount.js";

const acc = (id: string, ownerUserId: string, over: Partial<AccountChoice> = {}): AccountChoice =>
  ({ id, ownerUserId, type: "checking", isArchived: false, sortOrder: 0, ...over });

test("in a couple's pool the caller's own account wins over the partner's first-sorted one", () => {
  const pool = [acc("ex-main", "ex", { sortOrder: 0 }), acc("her-main", "her", { sortOrder: 5 })];
  assert.equal(pickDefaultAccount(pool, "her"), "her-main");
  assert.equal(pickDefaultAccount(pool, "ex"), "ex-main");
});

test("never a card while there is anything else, even the partner's account", () => {
  const pool = [acc("her-card", "her", { type: "card" }), acc("ex-main", "ex", { sortOrder: 3 })];
  assert.equal(pickDefaultAccount(pool, "her"), "ex-main");
  assert.equal(pickDefaultAccount([acc("her-card", "her", { type: "card" })], "her"), "her-card");
});

test("lowest sortOrder among equals; archived accounts are skipped; none → null", () => {
  assert.equal(pickDefaultAccount([acc("b", "her", { sortOrder: 2 }), acc("a", "her", { sortOrder: 1 })], "her"), "a");
  assert.equal(pickDefaultAccount([acc("old", "her", { isArchived: true }), acc("ex", "ex")], "her"), "ex");
  assert.equal(pickDefaultAccount([], "her"), null);
});
