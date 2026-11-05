// Run with:  node --import tsx --test server/lib/accountDeletion.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_STALE_MS, DELETION_GRACE_MS, claimActive, clashRenames, deletionDueAt, frozenAnchor, hasLiveSubscription, isDeletionDue, isLockNotAvailable, isOwnMovement,
  pairAction, purgeCutoff,
} from "./accountDeletion.js";

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

test("frozenAnchor keeps the live balance and never subtracts a future payment twice", () => {
  const at = new Date("2026-11-06T10:00:00Z");
  const past = new Date("2026-10-01T12:00:00Z");
  const future = new Date("2026-12-01T12:00:00Z");
  // anchor 100 € + purchase 20 € − future payment 15 € = 105 € live.
  const anchor = frozenAnchor(10_500, { purchases: [{ amount: 2_000, date: past }], adjustments: [] },
    [{ amount: 1_500, date: future, createdAt: past }], at);
  assert.equal(anchor, 12_000); // then 120 − 15 = 105, as before
  // A future adjustment stays in the ledger, a future purchase on D's account leaves it.
  assert.equal(frozenAnchor(10_000, {
    purchases: [{ amount: 700, date: future }], adjustments: [{ amount: 300, date: future }, { amount: 200, date: past }],
  }, [], at), 9_000);
  // A payment dated earlier the same day but recorded before the anchor drops out of the new ledger: it is in the anchor.
  assert.equal(frozenAnchor(5_000, { purchases: [], adjustments: [] },
    [{ amount: 1_000, date: new Date("2026-11-06T18:00:00Z"), createdAt: past }], at), 5_000);
});

test("isOwnMovement: who entered it; the payer only when nobody is recorded as creator", () => {
  // The route defaults the payer to the account's owner: S's purchase on D's card.
  assert.equal(isOwnMovement({ payerUserId: "D", createdByUserId: "S" }, "D"), false);
  assert.equal(isOwnMovement({ payerUserId: "S", createdByUserId: "D" }, "D"), true);
  assert.equal(isOwnMovement({ payerUserId: "D", createdByUserId: null }, "D"), true);
  assert.equal(isOwnMovement({ payerUserId: null, createdByUserId: null }, "D"), false);
});

test("claimActive: a claim blocks cancelling for an hour, then counts as released", () => {
  const now = new Date("2026-11-06T10:00:00Z");
  assert.equal(claimActive(null, now), false);
  assert.equal(claimActive(new Date(now.getTime() - 60_000), now), true);
  assert.equal(claimActive(new Date(now.getTime() - CLAIM_STALE_MS), now), false);
});

test("hasLiveSubscription: only a Stripe subscription that may still charge", () => {
  assert.equal(hasLiveSubscription({ stripeSubscriptionId: "sub", status: "active" }), true);
  assert.equal(hasLiveSubscription({ stripeSubscriptionId: "sub", status: "past_due" }), true);
  assert.equal(hasLiveSubscription({ stripeSubscriptionId: "sub", status: "cancelled" }), false);
  assert.equal(hasLiveSubscription({ stripeSubscriptionId: null, status: "active" }), false);
});
