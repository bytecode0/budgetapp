// Encryption at rest for third-party secrets (Open Banking connections).
//
// Nothing in this codebase encrypts data at rest today — otp.ts and
// importStatement.ts only ever use one-way SHA-256 hashing, which isn't
// reversible and can't hold a token we need to send back to a provider later.
// This is genuinely new infrastructure, not an extension of an existing helper.
//
// AES-256-GCM via Node's built-in crypto module (no new dependency). The key
// is derived from ENCRYPTION_KEY by SHA-256 so any passphrase length works,
// matching how the rest of this codebase already leans on SHA-256 for anything
// crypto-adjacent (otp.ts, importStatement.ts) rather than pulling in a KDF
// library for what's a single, low-traffic secret store.
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("ENCRYPTION_KEY is not configured — cannot encrypt/decrypt secrets");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/** True when ENCRYPTION_KEY is configured. Callers that store provider
 *  secrets should gate on this the same way AI features gate on aiEnabled(). */
export function encryptionEnabled(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}

/** Encrypts `plaintext` into a single self-contained string: "iv:authTag:ciphertext" (base64). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Decrypts a string produced by encrypt(). Throws if the key is wrong or the
 *  value was tampered with (GCM's auth tag check fails closed, not silently). */
export function decrypt(payload: string): string {
  const key = getKey();
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted payload");
  const [ivB64, tagB64, cipherB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(cipherB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
