import { test } from "node:test";
import assert from "node:assert/strict";
import { bankStrip, consentExpired, daysLeft, needsReconnect, pendingReviews, reviewQueue, sinceParts, statusAvailability, type StripConnection } from "./bankStrip.js";

const NOW = new Date("2026-11-03T10:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const conn = (over: Partial<StripConnection> = {}): StripConnection => ({
  id: "c1", institutionName: "BBVA", status: "active", isOwner: true, expiresAt: inDays(90), lastSyncedAt: inDays(-0.125),
  accounts: [{ id: "a1", name: "Cuenta", bankReviewedAt: inDays(-1), bankPendingReview: 0 }],
  ...over,
});
const strip = (connections: StripConnection[], over: Partial<Parameters<typeof bankStrip>[0]> = {}) =>
  bankStrip({ availability: "available", promptDismissed: false, connections, now: NOW, ...over });

test("not available shows nothing; couldn't check shows the retry, never the connect strip", () => {
  assert.deepEqual(strip([], { availability: "unavailable" }), { kind: "none" });
  assert.deepEqual(strip([], { availability: "loading" }), { kind: "none" });
  assert.deepEqual(strip([], { availability: "check_failed" }), { kind: "check_failed" });
});

test("connect: only with no connection owned and the prompt not dismissed", () => {
  assert.deepEqual(strip([]), { kind: "connect" });
  assert.deepEqual(strip([], { promptDismissed: true }), { kind: "none" });
  // A pending (never consented) connection of mine still counts as owned.
  assert.equal(strip([conn({ status: "pending" })]).kind, "none");
});

test("connected and nothing pending: the status line", () => {
  const c = conn();
  assert.deepEqual(strip([c]), { kind: "status", connections: [c] });
});

test("pending: count and bank; first-time reviews first in the flow", () => {
  const c = conn({
    accounts: [
      { id: "held", name: "Cuenta", bankReviewedAt: inDays(-1), bankPendingReview: 3 },
      { id: "new-card", name: "Tarjeta", bankReviewedAt: null, bankPendingReview: 0 },
    ],
  });
  const s = strip([c]);
  assert.equal(s.kind, "pending");
  if (s.kind !== "pending") return;
  assert.equal(s.count, 3);
  assert.equal(s.bank, "BBVA");
  assert.deepEqual(s.targets.map(t => [t.accountId, t.firstTime]), [["new-card", true], ["held", false]]);
});

test("pending across two banks names none", () => {
  const a = conn({ accounts: [{ id: "a", name: "A", bankReviewedAt: inDays(-1), bankPendingReview: 1 }] });
  const b = conn({ id: "c2", institutionName: "ING", accounts: [{ id: "b", name: "B", bankReviewedAt: inDays(-1), bankPendingReview: 2 }] });
  const s = strip([a, b]);
  assert.equal(s.kind === "pending" && s.bank, null);
  assert.equal(s.kind === "pending" && s.count, 3);
});

test("reconnect comes first, for an expired consent or one lapsing within 14 days", () => {
  assert.equal(needsReconnect(conn({ expiresAt: inDays(14) }), NOW), true);
  assert.equal(needsReconnect(conn({ expiresAt: inDays(15) }), NOW), false);
  assert.equal(needsReconnect(conn({ status: "expired", expiresAt: null }), NOW), true);
  const s = strip([conn({ expiresAt: inDays(5), accounts: [{ id: "a", name: "A", bankReviewedAt: null, bankPendingReview: 4 }] })]);
  assert.deepEqual(s.kind === "reconnect" && [s.expired, s.daysLeft], [false, 5]);
  // An expired consent can't be reviewed.
  assert.deepEqual(reviewQueue([conn({ status: "expired", accounts: [{ id: "a", name: "A", bankReviewedAt: null, bankPendingReview: 0 }] })], NOW), []);
});

test("a partner never gets the owner's reconnect or reviews: only the status line", () => {
  const owners = conn({ isOwner: false, expiresAt: inDays(3), accounts: [{ id: "a", name: "A", bankReviewedAt: null, bankPendingReview: 5 }] });
  // Banking available to the partner and no connection of their own: invited to connect.
  assert.deepEqual(strip([owners]), { kind: "connect" });
  // Once they closed the invitation: the household connection's status line.
  assert.deepEqual(strip([owners], { promptDismissed: true }), { kind: "status", connections: [owners] });
  assert.deepEqual(reviewQueue([owners], NOW), []);
  // Another member's never-consented connection isn't shown at all.
  assert.deepEqual(strip([conn({ isOwner: false, status: "pending" })], { promptDismissed: true }), { kind: "none" });
});

test("time since the last sync", () => {
  assert.deepEqual(sinceParts(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW), { value: -5, unit: "minute" });
  assert.deepEqual(sinceParts(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW), { value: -3, unit: "hour" });
  assert.deepEqual(sinceParts(new Date(NOW.getTime() - 3 * 86_400_000).toISOString(), NOW), { value: -3, unit: "day" });
  assert.deepEqual(sinceParts(new Date(NOW.getTime() + 60_000).toISOString(), NOW), { value: -0, unit: "minute" });
});

test("pending reviews (Home's notice) ignore other members' connections", () => {
  const mine = conn({ accounts: [{ id: "a", name: "A", bankReviewedAt: inDays(-1), bankPendingReview: 2 }] });
  const theirs = conn({ id: "c2", isOwner: false, institutionName: "ING", accounts: [{ id: "b", name: "B", bankReviewedAt: null, bankPendingReview: 7 }] });
  const p = pendingReviews([mine, theirs], NOW);
  assert.deepEqual([p.count, p.bank, p.targets.map(t => t.accountId)], [2, "BBVA", ["a"]]);
  assert.deepEqual(pendingReviews([theirs], NOW), { targets: [], count: 0, bank: null });
});

test("status: a failure is 'couldn't check' only for someone known to be eligible", () => {
  assert.equal(statusAvailability({ ok: true, enabled: true }, false), "available");
  assert.equal(statusAvailability({ ok: true, enabled: false }, true), "unavailable");
  assert.equal(statusAvailability({ ok: false, status: 503 }, true), "check_failed");
  assert.equal(statusAvailability({ ok: false }, true), "check_failed"); // network
  // Never seen eligible here (or off the allow-list): a 5xx shows nothing.
  assert.equal(statusAvailability({ ok: false, status: 500 }, false), "unavailable");
  assert.equal(statusAvailability({ ok: false }, false), "unavailable");
  // A 4xx is an answer, not a failure to check.
  assert.equal(statusAvailability({ ok: false, status: 401 }, true), "unavailable");
});

test("pending count and bank only over reviewable accounts: an expired consent's held rows aren't announced", () => {
  const live = conn({ accounts: [{ id: "a", name: "A", bankReviewedAt: inDays(-1), bankPendingReview: 2 }] });
  const lapsed = conn({ id: "c2", institutionName: "ING", status: "expired", accounts: [{ id: "b", name: "B", bankReviewedAt: inDays(-10), bankPendingReview: 9 }] });
  const stale = conn({ id: "c3", institutionName: "Sabadell", expiresAt: inDays(-0.5), accounts: [{ id: "c", name: "C", bankReviewedAt: inDays(-10), bankPendingReview: 4 }] });
  assert.deepEqual(pendingReviews([live, lapsed, stale], NOW), { targets: [{ connectionId: "c1", accountId: "a", accountName: "A", firstTime: false }], count: 2, bank: "BBVA" });
  assert.deepEqual(pendingReviews([lapsed, stale], NOW), { targets: [], count: 0, bank: null });
});

test("days left are calendar days in local time", () => {
  const now = new Date(2026, 10, 3, 23, 30); // 23:30 local
  assert.equal(daysLeft(new Date(2026, 10, 4, 0, 30).toISOString(), now), 1);  // one hour away, but tomorrow
  assert.equal(daysLeft(new Date(2026, 10, 3, 23, 59).toISOString(), now), 0); // later today
  assert.equal(daysLeft(new Date(2026, 10, 17, 8, 0).toISOString(), now), 14);
  assert.equal(daysLeft(new Date(2026, 10, 2, 8, 0).toISOString(), now), -1);
});

test("an active consent past its expiry is expired (Reconectar), not 'expires today'", () => {
  const now = new Date(2026, 10, 3, 12, 0);
  const past = conn({ status: "active", expiresAt: new Date(2026, 10, 3, 9, 0).toISOString() });
  assert.equal(consentExpired(past, now), true);
  const s = bankStrip({ availability: "available", promptDismissed: false, connections: [past], now });
  assert.deepEqual(s.kind === "reconnect" && [s.expired, s.daysLeft], [true, 0]);
  const later = conn({ status: "active", expiresAt: new Date(2026, 10, 3, 18, 0).toISOString() });
  const t = bankStrip({ availability: "available", promptDismissed: false, connections: [later], now });
  assert.deepEqual(t.kind === "reconnect" && [t.expired, t.daysLeft], [false, 0]);
});
