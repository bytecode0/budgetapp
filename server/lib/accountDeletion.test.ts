// Run with:  node --import tsx --test server/lib/accountDeletion.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DELETION_GRACE_MS, deletionDueAt, isDeletionDue, purgeCutoff } from "./accountDeletion.js";

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
