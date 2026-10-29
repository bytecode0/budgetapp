// Run with:  node --import tsx --test server/lib/partnerLink.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptBlocker, coupleChange } from "./partnerLink.js";

const free = { meLinkedTo: null, someoneLinkedToMe: false, senderLinkedTo: null, someoneLinkedToSender: false };

test("two unlinked people can link", () => {
  assert.equal(acceptBlocker(free), null);
});

test("a sender who already has a linked partner can't get a second one", () => {
  // Two invites accepted concurrently: the second accept, re-checked under the
  // sender's lock, sees the first one's link.
  assert.equal(acceptBlocker({ ...free, someoneLinkedToSender: true }), "The sender already has a linked partner");
});

test("chains are refused on both ends", () => {
  assert.ok(acceptBlocker({ ...free, meLinkedTo: "x" }));
  assert.ok(acceptBlocker({ ...free, someoneLinkedToMe: true }));
  assert.ok(acceptBlocker({ ...free, senderLinkedTo: "x" }));
});

// ── Repair re-check (server/scripts/repairPartnerData.ts) ──────────────────

const sameCouple = { memberLinkedTo: "pool", someoneLinkedToMember: false, poolLinkedTo: null };

test("a couple still linked the same way is repaired", () => {
  assert.equal(coupleChange("pool", sameCouple), null);
});

test("a couple that unlinked or relinked since the script read it is skipped", () => {
  assert.equal(coupleChange("pool", { ...sameCouple, memberLinkedTo: null }), "unlinked");
  assert.equal(coupleChange("pool", { ...sameCouple, memberLinkedTo: "someone-else" }), "relinked");
});

test("a couple that became a chain since is skipped", () => {
  assert.equal(coupleChange("pool", { ...sameCouple, someoneLinkedToMember: true }), "member_has_partner_linked");
  assert.equal(coupleChange("pool", { ...sameCouple, poolLinkedTo: "x" }), "pool_is_linked");
});
