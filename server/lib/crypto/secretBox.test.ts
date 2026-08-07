// Run with:  npx tsx --test server/lib/crypto/secretBox.test.ts
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, encryptionEnabled } from "./secretBox.js";

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

before(() => { process.env.ENCRYPTION_KEY = "test-encryption-key-do-not-use-in-prod"; });
after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

test("encryptionEnabled reflects whether ENCRYPTION_KEY is set", () => {
  assert.equal(encryptionEnabled(), true);
});

test("round-trips a plaintext string exactly", () => {
  const secret = "gocardless-access-token-abc123";
  const ciphertext = encrypt(secret);
  assert.notEqual(ciphertext, secret);
  assert.equal(decrypt(ciphertext), secret);
});

test("two encryptions of the same plaintext produce different ciphertext (random IV)", () => {
  const a = encrypt("same-secret");
  const b = encrypt("same-secret");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "same-secret");
  assert.equal(decrypt(b), "same-secret");
});

test("handles unicode and empty strings", () => {
  assert.equal(decrypt(encrypt("café ñ 日本語")), "café ñ 日本語");
  assert.equal(decrypt(encrypt("")), "");
});

test("tampered ciphertext fails to decrypt (GCM auth tag check)", () => {
  const ciphertext = encrypt("sensitive-token");
  const [iv, tag, body] = ciphertext.split(":");
  const tamperedBody = Buffer.from(body, "base64");
  tamperedBody[0] ^= 0xff; // flip a bit
  const tampered = [iv, tag, tamperedBody.toString("base64")].join(":");
  assert.throws(() => decrypt(tampered));
});

test("decrypting with the wrong key fails", () => {
  const ciphertext = encrypt("secret-under-key-a");
  const savedKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = "a-completely-different-key";
  try {
    assert.throws(() => decrypt(ciphertext));
  } finally {
    process.env.ENCRYPTION_KEY = savedKey;
  }
});

test("malformed payload throws instead of decrypting garbage", () => {
  assert.throws(() => decrypt("not-a-valid-payload"));
  assert.throws(() => decrypt("only:two-parts"));
});

test("throws a clear error when ENCRYPTION_KEY is missing", () => {
  const savedKey = process.env.ENCRYPTION_KEY;
  delete process.env.ENCRYPTION_KEY;
  try {
    assert.throws(() => encrypt("x"), /ENCRYPTION_KEY/);
  } finally {
    process.env.ENCRYPTION_KEY = savedKey;
  }
});
