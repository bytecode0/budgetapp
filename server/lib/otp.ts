import crypto from "crypto";

export const OTP_LENGTH = 6;
/** Wrong or right, each try spends one; the code is dead after this many. */
export const OTP_MAX_ATTEMPTS = 5;

/** A 6-digit code from a cryptographically secure source (leading zeros kept). */
export function generateOtp(): string {
  return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

/** Constant-time comparison of a typed code with the stored hash. */
export function verifyOtp(plain: string, hashed: string): boolean {
  const a = Buffer.from(hashOtp(plain), "hex");
  const b = Buffer.from(hashed, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The subset of the Prisma client that consumeOtp needs (a fake in tests). */
export interface OtpStore {
  otpToken: {
    findFirst(args: {
      where: { email: string; type: string; used: false };
      orderBy: { createdAt: "desc" };
    }): Promise<{ id: string; tokenHash: string } | null>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

export type OtpResult = "ok" | "incorrect" | "invalid";

/**
 * Checks a code and spends one attempt on it, safe under concurrent requests:
 * the attempt is reserved atomically BEFORE comparing, so a burst of parallel
 * guesses can't all compare against a counter that still reads 0. A code that
 * is expired, used or out of attempts is "invalid" (ask for a new one).
 */
export async function consumeOtp(
  db: OtpStore,
  email: string,
  type: string,
  otp: string,
  now: Date = new Date(),
): Promise<OtpResult> {
  if (typeof otp !== "string" || !/^\d+$/.test(otp)) return "incorrect";

  const record = await db.otpToken.findFirst({
    where: { email, type, used: false },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return "invalid";

  const reserved = await db.otpToken.updateMany({
    where: { id: record.id, used: false, expiresAt: { gt: now }, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (reserved.count === 0) return "invalid";

  if (!verifyOtp(otp, record.tokenHash)) return "incorrect";

  // Single use: only one concurrent request can flip `used`.
  const claimed = await db.otpToken.updateMany({
    where: { id: record.id, used: false },
    data: { used: true },
  });
  return claimed.count === 1 ? "ok" : "invalid";
}
