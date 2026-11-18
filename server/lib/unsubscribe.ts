// The "darte de baja" link of the monthly email (LPBETA-12): works without
// signing in, so it carries a signed token naming the person.
//
// Deliberately NOT a JWT: a JWT signed with JWT_SECRET that names a user is a
// session cookie to requireAuth, and a link in an email must never be one.
// The token is "<userId, base64url>.<HMAC-SHA256 of it, base64url>", keyed by
// a key derived from JWT_SECRET for this purpose only. It never expires (an
// old email's link still unsubscribes) and it can only do one thing: turn the
// monthly email off for that person.
import crypto from "crypto";

const PURPOSE = "remanso:monthly-email-unsubscribe:v1";

function key(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set: unsubscribe links cannot be signed");
  return crypto.createHmac("sha256", secret).update(PURPOSE).digest();
}

const sign = (userId: string) => crypto.createHmac("sha256", key()).update(userId).digest();

export function unsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString("base64url")}.${sign(userId).toString("base64url")}`;
}

/** The user id a token was signed for, or null when it is not a valid one. */
export function verifyUnsubscribeToken(token: unknown): string | null {
  if (typeof token !== "string" || token.length > 512) return null;
  const [id, mac, extra] = token.split(".");
  if (!id || !mac || extra !== undefined) return null;
  const userId = Buffer.from(id, "base64url").toString("utf8");
  if (!userId || Buffer.from(userId).toString("base64url") !== id) return null;
  const given = Buffer.from(mac, "base64url");
  const expected = sign(userId);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? userId : null;
}

/** The public page that confirms the unsubscribe (src/app/components/UnsubscribePage.tsx). */
export function unsubscribeUrl(appUrl: string, userId: string, lang: string): string {
  const url = new URL("/unsubscribe", appUrl);
  url.searchParams.set("token", unsubscribeToken(userId));
  url.searchParams.set("lang", lang);
  return url.toString();
}
