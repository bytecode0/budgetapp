import crypto from "crypto";

/** Genera un código OTP de 5 dígitos */
export function generateOtp(): string {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export function verifyOtp(plain: string, hashed: string): boolean {
  return hashOtp(plain) === hashed;
}
