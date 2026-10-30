// The two short-lived signed tokens of the consent round trip (§5.2). JWTs
// signed with JWT_SECRET, never a Map in memory: on Vercel the callback and
// the exchange can land on different instances. Both carry the person who
// started the connection in `sub` and NOT in `userId`, so requireAuth never
// takes one for a session cookie.
//
//   state     /connect → bank → /callback. Bound to the connection, the user
//             and a nonce kept in an httpOnly cookie (a link someone else
//             started can't be completed in your browser).
//   exchange  /callback → SPA (?bankToken=) → /exchange, which checks the
//             logged-in user is the same `sub`.
import crypto from "crypto";
import { signToken, verifyToken } from "../jwt.js";

const STATE_PURPOSE = "banking_connect";
const EXCHANGE_PURPOSE = "banking_exchange";
/** Time to choose the bank, log in and consent. */
export const STATE_TTL = "30m";
const EXCHANGE_TTL = "10m";

export const BANKING_STATE_COOKIE = "banking_oauth_state";
export const BANKING_STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const, // sent on the bank's top-level redirect back to us
  path: "/api/banking",
};
export const BANKING_STATE_MAX_AGE_MS = 30 * 60 * 1000;

export interface BankingHandoff { connectionId: string; userId: string }

export function newBankingNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function createConnectState(h: BankingHandoff & { nonce: string }): string {
  return signToken({ purpose: STATE_PURPOSE, sub: h.userId, connectionId: h.connectionId, nonce: h.nonce }, STATE_TTL);
}

/** The state's content when valid, unexpired AND its nonce equals the
 *  cookie's (constant time); null otherwise. */
export function readConnectState(state: unknown, cookieNonce: unknown): BankingHandoff | null {
  if (typeof state !== "string" || typeof cookieNonce !== "string" || !cookieNonce) return null;
  try {
    const p = verifyToken(state);
    if (p?.purpose !== STATE_PURPOSE || typeof p.sub !== "string" || typeof p.connectionId !== "string" || typeof p.nonce !== "string") return null;
    const a = Buffer.from(p.nonce), b = Buffer.from(cookieNonce);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return { connectionId: p.connectionId, userId: p.sub };
  } catch {
    return null;
  }
}

export function createExchangeToken(h: BankingHandoff): string {
  return signToken({ purpose: EXCHANGE_PURPOSE, sub: h.userId, connectionId: h.connectionId }, EXCHANGE_TTL);
}

export function readExchangeToken(token: unknown): BankingHandoff | null {
  if (typeof token !== "string") return null;
  try {
    const p = verifyToken(token);
    if (p?.purpose !== EXCHANGE_PURPOSE || typeof p.sub !== "string" || typeof p.connectionId !== "string") return null;
    return { connectionId: p.connectionId, userId: p.sub };
  } catch {
    return null;
  }
}
