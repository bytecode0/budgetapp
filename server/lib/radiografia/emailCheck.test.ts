import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCode, generateSalt, hashCode, verifyCode, generateAccessToken, generateAnonId } from "./emailCheck.js";

test("generateCode: always exactly 6 digits, zero-padded", () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.equal(code.length, 6, code);
    assert.match(code, /^\d{6}$/);
  }
});

test("generateCode: not obviously predictable (200 draws, no repeats in a row)", () => {
  const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
  // Birthday-paradox-safe: 200 draws from 1e6 space should almost never collide.
  assert.ok(codes.size >= 195, `too many collisions: ${codes.size}/200 unique`);
});

test("hashCode: deterministic for the same code+salt, differs by salt", () => {
  const salt1 = generateSalt();
  const salt2 = generateSalt();
  assert.equal(hashCode("123456", salt1), hashCode("123456", salt1));
  assert.notEqual(hashCode("123456", salt1), hashCode("123456", salt2));
});

test("verifyCode: accepts the right code, rejects a wrong one", () => {
  const salt = generateSalt();
  const code = "482913";
  const hash = hashCode(code, salt);
  assert.equal(verifyCode(code, salt, hash), true);
  assert.equal(verifyCode("000000", salt, hash), false);
  assert.equal(verifyCode(code, generateSalt(), hash), false, "wrong salt must also fail");
});

test("verifyCode: never throws on malformed/mismatched-length input", () => {
  const salt = generateSalt();
  const hash = hashCode("123456", salt);
  assert.doesNotThrow(() => verifyCode("123456", salt, "not-a-valid-hex-hash"));
  assert.doesNotThrow(() => verifyCode("123456", salt, ""));
  assert.equal(verifyCode("123456", salt, "ab"), false);
});

test("generateAccessToken / generateAnonId: high-entropy, unique across many draws", () => {
  const tokens = new Set(Array.from({ length: 100 }, () => generateAccessToken()));
  assert.equal(tokens.size, 100);
  const anonIds = new Set(Array.from({ length: 100 }, () => generateAnonId()));
  assert.equal(anonIds.size, 100);
  // Sanity on length/format — hex strings, not something short and guessable.
  assert.ok(generateAccessToken().length >= 48);
  assert.ok(generateAnonId().length >= 32);
});
