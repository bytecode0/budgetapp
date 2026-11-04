// Run with:  node --import tsx --test server/lib/loginThrottle.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearLoginFailures, LOGIN_LOCK_MS, LOGIN_MAX_FAILURES, reserveLoginAttempt } from "./loginThrottle.js";
import { fakeTable } from "./fakeRows.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

function store() {
  const user = fakeTable([{ id: "u1", failedLogins: 0, loginLockedUntil: null }]);
  return { db: { user }, row: user.rows[0] };
}

test(`${LOGIN_MAX_FAILURES} tries are allowed, the next one locks`, async () => {
  const { db, row } = store();
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) assert.equal(await reserveLoginAttempt(db, "u1", NOW), "ok");
  assert.equal(await reserveLoginAttempt(db, "u1", NOW), "locked");
  assert.deepEqual(row.loginLockedUntil, later(LOGIN_LOCK_MS));
  assert.equal(await reserveLoginAttempt(db, "u1", later(LOGIN_LOCK_MS - 1)), "locked");
});

test("the lock runs out and the count starts again", async () => {
  const { db, row } = store();
  for (let i = 0; i <= LOGIN_MAX_FAILURES; i++) await reserveLoginAttempt(db, "u1", NOW);
  assert.equal(await reserveLoginAttempt(db, "u1", later(LOGIN_LOCK_MS)), "ok");
  assert.equal(row.failedLogins, 1);
  assert.equal(row.loginLockedUntil, null);
});

test("a success clears the count", async () => {
  const { db, row } = store();
  for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await reserveLoginAttempt(db, "u1", NOW);
  await clearLoginFailures(db, "u1");
  assert.equal(row.failedLogins, 0);
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) assert.equal(await reserveLoginAttempt(db, "u1", NOW), "ok");
});

test("a burst of parallel tries gets at most LOGIN_MAX_FAILURES compares", async () => {
  const { db } = store();
  const results = await Promise.all(Array.from({ length: 40 }, () => reserveLoginAttempt(db, "u1", NOW)));
  assert.equal(results.filter((r) => r === "ok").length, LOGIN_MAX_FAILURES);
});
