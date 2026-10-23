import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ??= "test-secret";
const { createGoogleSession, readGoogleSession } = await import("./auth.js");
const { signToken, verifyToken } = await import("../lib/jwt.js");

test("a Google exchange token round-trips to its user, on any instance", () => {
  const token = createGoogleSession("user-1");
  assert.equal(readGoogleSession(token), "user-1");
});

test("a Google exchange token is never usable as a session cookie", () => {
  // requireAuth reads payload.userId: the exchange token must not carry it.
  const payload = verifyToken(createGoogleSession("user-1"));
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
    { purpose: "google_exchange", sub: "user-1", exp: Math.floor(Date.now() / 1000) - 1 },
    process.env.JWT_SECRET!,
  );
  assert.equal(readGoogleSession(expired), null);
  const forged = jwt.sign({ purpose: "google_exchange", sub: "user-1" }, "another-secret");
  assert.equal(readGoogleSession(forged), null);
});
