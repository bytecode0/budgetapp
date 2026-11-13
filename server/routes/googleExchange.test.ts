import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ??= "test-secret";
const { signGoogleSession, readGoogleSession } = await import("./auth.js");
const { signToken, verifyToken } = await import("../lib/jwt.js");

test("a Google exchange token round-trips to its user and jti, on any instance", () => {
  const token = signGoogleSession("user-1", "jti-1");
  assert.deepEqual(readGoogleSession(token), { userId: "user-1", jti: "jti-1" });
});

test("a Google exchange token without a jti (not single-use) is rejected", () => {
  assert.equal(readGoogleSession(signToken({ purpose: "google_exchange", sub: "user-1" }, "2m")), null);
});

test("a Google exchange token is never usable as a session cookie", () => {
  // requireAuth reads payload.userId: the exchange token must not carry it.
  const payload = verifyToken(signGoogleSession("user-1", "jti-1"));
  assert.equal(payload.userId, undefined);
});

test("other tokens are not accepted as a Google exchange token", () => {
  assert.equal(readGoogleSession(signToken({ userId: "user-1" })), null);
  assert.equal(readGoogleSession(signToken({ email: "a@b.c", type: "password_reset" }, "15m")), null);
  assert.equal(readGoogleSession(signToken({ purpose: "banking_connect", connectionId: "c" }, "10m")), null);
  assert.equal(readGoogleSession("not-a-jwt"), null);
});

test("an expired or foreign-signed Google exchange token is rejected", () => {
  const expired = jwt.sign(
    { purpose: "google_exchange", sub: "user-1", jti: "j", exp: Math.floor(Date.now() / 1000) - 1 },
    process.env.JWT_SECRET!,
  );
  assert.equal(readGoogleSession(expired), null);
  const forged = jwt.sign({ purpose: "google_exchange", sub: "user-1", jti: "j" }, "another-secret");
  assert.equal(readGoogleSession(forged), null);
});
