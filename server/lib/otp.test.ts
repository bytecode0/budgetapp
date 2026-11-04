// Run with:  node --import tsx --test server/lib/otp.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeOtp, generateOtp, hashOtp, OTP_LENGTH, OTP_MAX_ATTEMPTS, verifyOtp } from "./otp.js";
import { fakeTable } from "./fakeRows.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const EMAIL = "ana@example.com";

function storeWith(code: string, overrides: Record<string, unknown> = {}) {
  const otpToken = fakeTable([{
    id: "t1", email: EMAIL, type: "password_reset", tokenHash: hashOtp(code), used: false, attempts: 0,
    expiresAt: new Date(NOW.getTime() + 15 * 60_000), createdAt: new Date(NOW.getTime() - 1000), ...overrides,
  }]);
  return { db: { otpToken }, row: otpToken.rows[0] };
}

test("generateOtp gives 6 digits, leading zeros kept", () => {
  for (let i = 0; i < 200; i++) assert.match(generateOtp(), new RegExp(`^\\d{${OTP_LENGTH}}$`));
});

test("verifyOtp accepts the right code only", () => {
  assert.equal(verifyOtp("012345", hashOtp("012345")), true);
  assert.equal(verifyOtp("012346", hashOtp("012345")), false);
});

test("the right code works once", async () => {
  const { db, row } = storeWith("123456");
  assert.equal(await consumeOtp(db, EMAIL, "password_reset", "123456", NOW), "ok");
  assert.equal(row.used, true);
  assert.equal(await consumeOtp(db, EMAIL, "password_reset", "123456", NOW), "invalid");
});

test(`after ${OTP_MAX_ATTEMPTS} wrong tries the code is dead, even the right one`, async () => {
  const { db, row } = storeWith("123456");
  for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
    assert.equal(await consumeOtp(db, EMAIL, "password_reset", "000000", NOW), "incorrect");
  }
  assert.equal(row.attempts, OTP_MAX_ATTEMPTS);
  assert.equal(await consumeOtp(db, EMAIL, "password_reset", "123456", NOW), "invalid");
  assert.equal(row.used, false);
});

test("a burst of parallel guesses compares at most OTP_MAX_ATTEMPTS times", async () => {
  const { db } = storeWith("123456");
  const guesses = Array.from({ length: 50 }, (_, i) => String(100000 + i));
  const results = await Promise.all(guesses.map((g) => consumeOtp(db, EMAIL, "password_reset", g, NOW)));
  assert.equal(results.filter((r) => r === "incorrect").length, OTP_MAX_ATTEMPTS);
  assert.equal(results.filter((r) => r === "invalid").length, 50 - OTP_MAX_ATTEMPTS);
});

test("an expired code is invalid and spends nothing", async () => {
  const { db, row } = storeWith("123456", { expiresAt: new Date(NOW.getTime() - 1) });
  assert.equal(await consumeOtp(db, EMAIL, "password_reset", "123456", NOW), "invalid");
  assert.equal(row.attempts, 0);
});

test("no code for that email or type is invalid; non-digits are incorrect", async () => {
  const { db } = storeWith("123456");
  assert.equal(await consumeOtp(db, "other@example.com", "password_reset", "123456", NOW), "invalid");
  assert.equal(await consumeOtp(db, EMAIL, "email_verification", "123456", NOW), "invalid");
  assert.equal(await consumeOtp(db, EMAIL, "password_reset", "12a456", NOW), "incorrect");
});
