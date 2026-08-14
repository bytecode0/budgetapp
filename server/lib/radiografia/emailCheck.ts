// Email confirmation for the Radiografía onboarding — proves an email exists
// and receives, WITHOUT building identity: no session, no login, no password.
// See docs/plan-onboarding-radiografia.md §0.2. Deliberately its own isolated
// module: CLAUDE.md marks the BudgetApp's auth (server/lib/otp.ts, OtpToken)
// as "do not modify without asking", and this must not inherit its defects
// (5-digit code, Math.random(), unsalted hash, no attempt limit — see plan §1.6).
import { randomInt, randomBytes, createHash, timingSafeEqual } from "node:crypto";

export const EMAIL_CHECK_TTL_MS = 15 * 60 * 1000; // 15 min
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60 * 1000; // 60s

/** 6-digit code. crypto.randomInt, never Math.random (predictable). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Per-row salt — two identical codes issued to different people never hash the same. */
export function generateSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashCode(code: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

/**
 * Constant-time comparison. A naive `===` on the hash leaks timing
 * information proportional to how many leading bytes matched — irrelevant for
 * a hash in isolation, but the discipline matters here because this is the
 * one check standing between a public endpoint and "prove you own this email".
 */
export function verifyCode(code: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashCode(code, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** High-entropy opaque token for RadiografiaAccessToken — never a JWT, never tied to a session. */
export function generateAccessToken(): string {
  return randomBytes(32).toString("hex");
}

/** Opaque anonId for a not-yet-identified profile — same shape/purpose as the access token. */
export function generateAnonId(): string {
  return randomBytes(24).toString("hex");
}
