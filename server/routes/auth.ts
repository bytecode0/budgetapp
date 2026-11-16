import { Router, Request, Response } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { sessionVersionMatches, signSessionToken, signToken, verifyToken } from "../lib/jwt.js";
import { consumeOtp, generateOtp, hashOtp, type OtpResult } from "../lib/otp.js";
import { clearLoginFailures, reserveLoginAttempt, reserveUnknownLoginAttempt } from "../lib/loginThrottle.js";
import { findUserIdByEmail, normalizeEmail } from "../lib/emailAddress.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { createDefaultAllocations } from "../lib/defaults.js";
import { googleSignIn } from "../lib/googleSignIn.js";
import { codeSendChecks, prismaRateLimitStore, takeRateLimit } from "../lib/rateLimit.js";
import {
  sendAccountExistsEmail,
  sendVerificationEmail,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendWelcomeGoogleEmail,
} from "../lib/mailer.js";
import { parseLocale, resolveLocale, type EmailLocale } from "../lib/email/locales/index.js";

export const authRouter = Router();

// Google sign-in needs all three, with no fallback: a default callback URL hid
// a missing variable in the first deploy (it redirected to localhost).
const GOOGLE_ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"] as const;

export function missingGoogleEnv(env: Record<string, string | undefined> = process.env): string[] {
  return GOOGLE_ENV.filter((name) => !env[name]);
}

// Token temporal para el intercambio post-OAuth: un JWT firmado de 2 min, no un
// Map en memoria — en Vercel el callback y el exchange pueden caer en instancias
// distintas. Lleva el usuario en `sub` y NO en `userId`, para que requireAuth
// nunca lo acepte como cookie de sesión.
//
// Single use (LPBETA-23 item 2): the token travels in the URL, so it can end
// up in the browser history or a log. It carries a random `jti` whose hash is
// stored as an OtpToken row of type "google_exchange" (no schema of its own);
// the exchange deletes that row, and only the request that deletes it gets a
// session. A copied URL is dead once the app has used it.
const GOOGLE_EXCHANGE_PURPOSE = "google_exchange";
const GOOGLE_EXCHANGE_TTL_MS = 2 * 60 * 1000;
const hashJti = (jti: string) => createHash("sha256").update(jti).digest("hex");

export function signGoogleSession(userId: string, jti: string): string {
  return signToken({ purpose: GOOGLE_EXCHANGE_PURPOSE, sub: userId, jti }, "2m");
}

/** The user and jti inside a valid, unexpired exchange token; null otherwise. */
export function readGoogleSession(token: string): { userId: string; jti: string } | null {
  try {
    const payload = verifyToken(token);
    if (payload?.purpose !== GOOGLE_EXCHANGE_PURPOSE || typeof payload.sub !== "string" || typeof payload.jti !== "string") {
      return null;
    }
    return { userId: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}

type ExchangeDb = Pick<PrismaClient, "otpToken">;

/** A new single-use exchange token for `userId` (its row is what makes it usable). */
export async function issueGoogleSession(db: ExchangeDb, userId: string, email: string, now: Date = new Date()): Promise<string> {
  const jti = randomBytes(32).toString("base64url");
  // Unused tokens of anyone, past their 2 minutes: nothing else deletes them.
  await db.otpToken.deleteMany({ where: { type: GOOGLE_EXCHANGE_PURPOSE, expiresAt: { lt: now } } });
  await db.otpToken.create({
    data: { email: normalizeEmail(email), type: GOOGLE_EXCHANGE_PURPOSE, tokenHash: hashJti(jti), expiresAt: new Date(now.getTime() + GOOGLE_EXCHANGE_TTL_MS) },
  });
  return signGoogleSession(userId, jti);
}

/** The userId for a valid exchange token, spending it; null if invalid, expired or already used. */
export async function consumeGoogleSession(db: ExchangeDb, token: string, now: Date = new Date()): Promise<string | null> {
  const session = readGoogleSession(token);
  if (!session) return null;
  const { count } = await db.otpToken.deleteMany({
    where: { type: GOOGLE_EXCHANGE_PURPOSE, tokenHash: hashJti(session.jti), expiresAt: { gt: now } },
  });
  return count === 1 ? session.userId : null;
}

// OAuth CSRF protection: GET /google puts a random nonce in an httpOnly cookie
// and the same nonce in `state`; the callback only exchanges a code when the
// two match, so a sign-in can't be completed in a browser that didn't start it
// (login CSRF). `state` is `<nonce>` or `<nonce>.<lang>`: the UI language rides
// along so a new user's settings are created in it (not a secret, re-validated
// on the way back). base64url never contains a '.'.
export const GOOGLE_STATE_COOKIE = "google_oauth_state";
const GOOGLE_STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth/google", // also covers /api/auth/google/callback
};
const GOOGLE_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding

export function newGoogleNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function buildGoogleState(nonce: string, lang: EmailLocale | null): string {
  return lang ? `${nonce}.${lang}` : nonce;
}

/** The nonce and (validated) language inside a `state`; null when malformed. */
export function parseGoogleState(state: unknown): { nonce: string; lang: EmailLocale | null } | null {
  if (typeof state !== "string") return null;
  const dot = state.indexOf(".");
  const nonce = dot === -1 ? state : state.slice(0, dot);
  if (!NONCE_PATTERN.test(nonce)) return null;
  return { nonce, lang: dot === -1 ? null : parseLocale(state.slice(dot + 1)) };
}

/** Constant-time comparison of the cookie's nonce with the one in `state`. */
export function googleNonceMatches(cookieNonce: unknown, stateNonce: string): boolean {
  if (typeof cookieNonce !== "string") return false;
  const a = Buffer.from(cookieNonce);
  const b = Buffer.from(stateNonce);
  return a.length === b.length && timingSafeEqual(a, b);
}

// One client per request: getToken/setCredentials mutate it, and a shared
// client would mix up concurrent sign-ins. Null when Google isn't configured.
function newGoogleClient(): OAuth2Client | null {
  const missing = missingGoogleEnv();
  if (missing.length) {
    console.error(`[auth/google] not configured, missing: ${missing.join(", ")}`);
    return null;
  }
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL
  );
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

/** The session cookie, carrying the user's current session version (LPBETA-21). */
function setAuthCookie(res: Response, user: { id: string; tokenVersion: number }) {
  res.cookie("token", signSessionToken(user.id, user.tokenVersion), COOKIE_OPTS);
}

const CLEAR_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

// ── Google OAuth ──────────────────────────────────────────────

authRouter.get("/google", (req: Request, res: Response) => {
  const googleClient = newGoogleClient();
  // A top-level navigation, not a fetch: send the browser back to the app with
  // the same error the callback uses, never to Google.
  if (!googleClient) return res.redirect(`${process.env.APP_URL ?? "http://localhost:5173"}/?error=google_failed`);
  const nonce = newGoogleNonce();
  res.cookie(GOOGLE_STATE_COOKIE, nonce, { ...GOOGLE_STATE_COOKIE_OPTS, maxAge: GOOGLE_STATE_MAX_AGE_MS });
  const url = googleClient.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account",
    state: buildGoogleState(nonce, parseLocale(req.query.lang)),
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  });
  res.redirect(url);
});

authRouter.get("/google/callback", async (req: Request, res: Response) => {
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  const { code, error, state } = req.query as Record<string, string>;
  // Single use: cleared whatever happens next.
  const cookieNonce = req.cookies?.[GOOGLE_STATE_COOKIE];
  res.clearCookie(GOOGLE_STATE_COOKIE, GOOGLE_STATE_COOKIE_OPTS);

  if (error || !code) {
    return res.redirect(`${appUrl}/?error=google_denied`);
  }

  const parsedState = parseGoogleState(state);
  if (!parsedState || !googleNonceMatches(cookieNonce, parsedState.nonce)) {
    console.error("[auth/google/callback] state does not match the sign-in cookie");
    return res.redirect(`${appUrl}/?error=google_failed`);
  }

  const googleClient = newGoogleClient();
  if (!googleClient) return res.redirect(`${appUrl}/?error=google_failed`);

  try {
    const { tokens } = await googleClient.getToken(code);
    googleClient.setCredentials(tokens);

    const { data } = await googleClient.request<{
      id: string;
      email: string;
      name: string;
      picture: string;
      verified_email: boolean;
    }>({ url: "https://www.googleapis.com/oauth2/v2/userinfo" });

    const signIn = await googleSignIn(prisma, data, parsedState.lang);
    if ("error" in signIn) {
      if (signIn.error === "no_email") return res.redirect(`${appUrl}/?error=google_no_email`);
      console.error("[auth/google/callback] Google says the email is not verified");
      return res.redirect(`${appUrl}/?error=google_failed`);
    }

    // An unverified account Google just verified is, for the person, a new
    // one: welcome them and seed it (createDefaultAllocations skips an
    // account that already has categories).
    if (signIn.isNewUser || signIn.claimed) {
      const locale = parsedState.lang ?? undefined;
      sendWelcomeGoogleEmail(signIn.email, signIn.name ?? "", locale).catch((e) =>
        console.error("[auth/google/callback] welcome google email failed:", e)
      );
      createDefaultAllocations(signIn.userId, locale).catch((e) =>
        console.error("[auth/google/callback] createDefaultAllocations failed:", e)
      );
    }

    const sessionToken = await issueGoogleSession(prisma, signIn.userId, signIn.email);
    return res.redirect(`${appUrl}/auth/google/callback?token=${sessionToken}`);
  } catch (err) {
    console.error("[auth/google/callback]", err);
    return res.redirect(`${appUrl}/?error=google_failed`);
  }
});

authRouter.post("/google/exchange", async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) return res.status(400).json({ error: "Token is required" });

  const sessionUserId = typeof token === "string" ? await consumeGoogleSession(prisma, token) : null;
  if (!sessionUserId) {
    return res.status(400).json({ error: "Invalid or expired session token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    include: { subscription: true },
  });

  if (!user) return res.status(400).json({ error: "User not found" });

  setAuthCookie(res, user);

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      plan: user.subscription?.plan ?? "free",
      subscriptionStatus: user.subscription?.status ?? null,
      currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: user.subscription?.cancelAtPeriodEnd ?? false,
    },
  });
});

const OTP_TTL_MS = 15 * 60 * 1000;

async function createOtp(email: string, type: string) {
  await prisma.otpToken.deleteMany({ where: { email, type } });
  const otp = generateOtp();
  await prisma.otpToken.create({
    data: {
      email,
      tokenHash: hashOtp(otp),
      type,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });
  return otp;
}

/** The 400 for a code that didn't verify; `code` lets the UI tell the two apart. */
function otpFailure(res: Response, result: Exclude<OtpResult, "ok">) {
  return result === "incorrect"
    ? res.status(400).json({ error: "Incorrect code", code: "otp_incorrect" })
    : res.status(400).json({ error: "Code expired or invalid, request a new one", code: "otp_invalid" });
}

// A password-reset token is bound to the password it replaces: once the
// password changes, the token no longer matches, so it works only once.
export function passwordFingerprint(passwordHash: string | null): string {
  return createHash("sha256").update(passwordHash ?? "").digest("hex").slice(0, 32);
}

// bcrypt hash of a random string: comparing against it when the email has no
// password keeps the response time the same as for a wrong password.
// Built on first use, not at import: it would add ~70 ms to every cold start.
let dummyPasswordHash: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  return (dummyPasswordHash ??= bcrypt.hash(randomBytes(16).toString("hex"), 10));
}

// Emailed codes are rate limited (LPBETA-16, server/lib/rateLimit.ts) per
// address and per IP. Every request counts, before looking the email up, so
// whether the limit is reached says nothing about whether an account exists.
const rateLimitStore = prismaRateLimitStore(prisma);
function allowCodeSend(email: string, req: Request): Promise<boolean> {
  return takeRateLimit(rateLimitStore, codeSendChecks(email, req.ip));
}

const OTP_TYPES = new Set(["email_verification", "password_reset"]);

// Register. One answer whether or not the email already has an account
// (LPBETA-23 item 5): a new or unverified account gets a code; a verified one
// gets an email saying it already exists ("sign in or reset your password")
// and nothing about it changes. Both go through the same code limits
// (LPBETA-16), so this can't be used to flood an inbox either.
const REGISTER_SENT = { message: "Verification email sent" };
authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, password, language } = req.body;

    if (!name || !req.body.email || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }
    if (typeof req.body.email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password must be text" });
    }
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: "Name, email and password are required" });

    // Optional: the UI language at sign-up, used for the verification email and
    // saved to UserSettings below (createDefaultAllocations keeps it on verify).
    const locale = language === undefined ? "es" : parseLocale(language);
    if (!locale) {
      return res.status(400).json({ error: "language must be 'es' or 'en'" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    if (!(await allowCodeSend(email, req))) {
      return res.status(429).json({ error: "Too many codes requested, try again later", code: "rate_limited" });
    }

    const existingId = await findUserIdByEmail(prisma, email);
    const existing = existingId ? await prisma.user.findUnique({
      where: { id: existingId },
      include: { settings: { select: { language: true } } },
    }) : null;
    // Hashed in every case, so an existing account doesn't answer faster.
    const passwordHash = await bcrypt.hash(password, 10);

    const accountExists = async (account: NonNullable<typeof existing>) => {
      // A code that can't be typed, never sent, in the same place a new
      // account's code goes: a wrong code on /verify-email then answers
      // otp_incorrect and spends an attempt exactly as for a new account
      // (with no code there it would say otp_invalid). Its hash is of a
      // non-digit string, and consumeOtp only compares digit strings, so it
      // can never verify, whatever is typed.
      await prisma.otpToken.deleteMany({ where: { email, type: "email_verification" } });
      await prisma.otpToken.create({
        data: {
          email,
          type: "email_verification",
          tokenHash: hashOtp(`unusable:${randomBytes(32).toString("base64url")}`),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });
      await sendAccountExistsEmail(account.email ?? email, account.name ?? "", resolveLocale(account.settings?.language));
      return res.json(REGISTER_SENT);
    };
    if (existing?.emailVerified) return accountExists(existing);

    // Only while the account is still unverified: if it was verified since the
    // check above (by its code or by Google), its password is not ours to set.
    if (existing) {
      const updated = await prisma.user.updateMany({
        where: { id: existing.id, emailVerified: null },
        data: { name, passwordHash },
      });
      if (updated.count !== 1) return accountExists(existing);
    }
    const userId = existing ? existing.id : (await prisma.user.create({ data: { name, email, passwordHash } })).id;
    await prisma.userSettings.upsert({
      where: { userId },
      update: { language: locale },
      create: { userId, monthlyIncome: 0, language: locale },
    });

    const otp = await createOtp(email, "email_verification");
    await sendVerificationEmail(email, name, otp, locale);

    return res.json(REGISTER_SENT);
  } catch (err) {
    console.error("[auth/register]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verify email OTP
authRouter.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const { email, otp, password, name, language } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }
    // The name and UI language typed at sign-up, for the same reason as the
    // password below: what is stored came from the last register, maybe not
    // the owner's. Absent (login path, reload, old bundle) → no name and the
    // default language.
    const hasName = name !== undefined && name !== null && name !== "";
    if (hasName && typeof name !== "string") {
      return res.status(400).json({ error: "Name must be text" });
    }
    const locale = language === undefined || language === null ? "es" : parseLocale(language);
    if (!locale) {
      return res.status(400).json({ error: "language must be 'es' or 'en'" });
    }
    // The password typed at sign-up.
    // Optional: without it the account is verified with no password at all.
    if (password !== undefined && password !== null && password !== "" &&
        (typeof password !== "string" || password.length < 8)) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const address = normalizeEmail(String(email));
    const result = await consumeOtp(prisma, address, "email_verification", String(otp));
    if (result !== "ok") return otpFailure(res, result);
    const foundId = await findUserIdByEmail(prisma, address);
    if (!foundId) return otpFailure(res, "invalid");
    const found = { id: foundId };

    // Verifying sets the password, in the same conditional update as the
    // verification: the stored hash is whatever the LAST register wrote, and
    // that may be someone else who registered this email after its owner
    // (the code still reaches only the owner). So it is replaced by the one
    // the person verifying typed, or dropped when the request has none (page
    // reloaded): they can use "forgot password" or Google. An account that
    // was already verified keeps its password.
    const passwordHash = typeof password === "string" && password ? await bcrypt.hash(password, 10) : null;
    const verified = await prisma.user.updateMany({
      where: { id: found.id, emailVerified: null },
      data: {
        emailVerified: new Date(),
        passwordHash,
        name: hasName ? name : null,
        failedLogins: 0,
        loginLockedUntil: null,
      },
    });
    if (verified.count === 1) {
      // Only on the unverified → verified step: a verified account keeps its settings.
      await prisma.userSettings.upsert({
        where: { userId: found.id },
        update: { language: locale },
        create: { userId: found.id, monthlyIncome: 0, language: locale },
      });
    }
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: found.id },
      include: { settings: { select: { language: true } } },
    });

    setAuthCookie(res, user);

    sendWelcomeEmail(user.email!, user.name ?? "", resolveLocale(user.settings?.language)).catch((e) =>
      console.error("[auth/verify-email] welcome email failed:", e)
    );

    createDefaultAllocations(user.id).catch((e) =>
      console.error("[auth/verify-email] createDefaultAllocations failed:", e)
    );

    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { subscription: true },
    });

    return res.json({
      // false: the account has no password (none came with this request), so
      // the screen tells them to create one with "forgot password" or use Google.
      passwordSet: user.passwordHash !== null,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        plan: fullUser?.subscription?.plan ?? "free",
        subscriptionStatus: fullUser?.subscription?.status ?? null,
        currentPeriodEnd: fullUser?.subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: fullUser?.subscription?.cancelAtPeriodEnd ?? false,
      },
    });
  } catch (err) {
    console.error("[auth/verify-email]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Resend OTP. One answer for a code sent, an unknown email and a limit
// reached, so the response doesn't reveal which emails have an account.
//
// Known gap, here and in /send-reset: the body is the same, but not the rest.
// Only a real account waits for the email provider, so it answers slower
// (hundreds of ms), and a provider failure (quota, outage) turns into a 500
// only for a real account. Both still tell, to someone who measures, whether
// an email has an account. Closing it means answering before sending (send in
// the background, which a Vercel function may cut off) or padding the time;
// left for later. /register has a smaller version of the same gap: both of its
// cases send an email, but a different one (code vs "you already have an
// account") after different database work, so the times are close, not equal.
const RESEND_SENT = { message: "If an account exists, a new code was sent" };
authRouter.post("/resend-otp", async (req: Request, res: Response) => {
  try {
    const { type } = req.body;

    if (!req.body.email || !type) {
      return res.status(400).json({ error: "Email and type are required" });
    }
    if (typeof req.body.email !== "string" || !OTP_TYPES.has(type)) {
      return res.status(400).json({ error: "Invalid email or code type" });
    }
    const email = normalizeEmail(req.body.email);

    if (!(await allowCodeSend(email, req))) return res.json(RESEND_SENT);

    const userId = await findUserIdByEmail(prisma, email);
    const user = userId ? await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: { select: { language: true } } },
    }) : null;
    if (!user) return res.json(RESEND_SENT);

    const last = await prisma.otpToken.findFirst({
      where: { email, type, used: false },
      orderBy: { createdAt: "desc" },
    });

    // The screens wait 60 s before offering a resend; a request inside that gets the same answer.
    if (last && last.createdAt > new Date(Date.now() - 60_000)) return res.json(RESEND_SENT);

    const otp = await createOtp(email, type);

    const locale = resolveLocale(user.settings?.language);
    if (type === "email_verification") {
      await sendVerificationEmail(email, user.name ?? "", otp, locale);
    } else if (type === "password_reset") {
      await sendPasswordResetEmail(email, otp, locale);
    }

    return res.json(RESEND_SENT);
  } catch (err) {
    console.error("[auth/resend-otp]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Send password reset OTP. One answer for a code sent, an unknown email and a
// limit reached, so the response doesn't reveal which emails have an account.
const RESET_SENT = { message: "If an account exists, a reset code was sent" };
authRouter.post("/send-reset", async (req: Request, res: Response) => {
  try {
    if (!req.body.email) return res.status(400).json({ error: "Email is required" });
    if (typeof req.body.email !== "string") return res.status(400).json({ error: "Invalid email" });
    const email = normalizeEmail(req.body.email);

    if (!(await allowCodeSend(email, req))) return res.json(RESET_SENT);

    const userId = await findUserIdByEmail(prisma, email);
    const user = userId ? await prisma.user.findUnique({
      where: { id: userId },
      include: { settings: { select: { language: true } } },
    }) : null;
    if (!user) return res.json(RESET_SENT);

    const otp = await createOtp(email, "password_reset");
    await sendPasswordResetEmail(email, otp, resolveLocale(user.settings?.language));

    return res.json(RESET_SENT);
  } catch (err) {
    console.error("[auth/send-reset]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verify reset OTP — returns short-lived signed token
authRouter.post("/verify-reset-otp", async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const address = normalizeEmail(String(email));
    const result = await consumeOtp(prisma, address, "password_reset", String(otp));
    if (result !== "ok") return otpFailure(res, result);

    const userId = await findUserIdByEmail(prisma, address);
    const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }) : null;
    if (!user) return otpFailure(res, "invalid");

    const resetToken = signToken(
      { email: address, type: "password_reset", pwf: passwordFingerprint(user.passwordHash) },
      "15m",
    );
    return res.json({ resetToken });
  } catch (err) {
    console.error("[auth/verify-reset-otp]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Apply new password
authRouter.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: "Reset token and new password are required" });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    let payload: any;
    try {
      payload = verifyToken(resetToken);
    } catch {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    if (payload.type !== "password_reset" || !payload.email || typeof payload.pwf !== "string") {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const userId = await findUserIdByEmail(prisma, String(payload.email));
    const user = userId ? await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, passwordHash: true, settings: { select: { language: true } } },
    }) : null;
    // The token only works for the password it was issued against: once used
    // (the password changed), it no longer matches.
    if (!user || passwordFingerprint(user.passwordHash) !== payload.pwf) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    // Conditional on the password being unchanged since the check above, so
    // two concurrent uses of the same token can't both succeed. The session
    // version goes up with it (LPBETA-21): every open session, wherever it
    // is, ends, including one an attacker may hold.
    const updated = await prisma.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash },
      data: { passwordHash, failedLogins: 0, loginLockedUntil: null, tokenVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }
    // No new session here: the reset screen sends them to sign in with the
    // new password (a code proves the inbox, not that this browser should stay
    // signed in). This browser's old cookie is dead anyway; drop it.
    res.clearCookie("token", CLEAR_COOKIE_OPTS);

    sendPasswordChangedEmail(user.email!, user.name ?? "", resolveLocale(user.settings?.language)).catch((e) =>
      console.error("[auth/reset-password] password changed email failed:", e)
    );

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("[auth/reset-password]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Login
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(typeof req.body.email === "string" ? req.body.email : "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // The lock answers the same whether or not the email has an account
    // (LPBETA-23 item 5): an email with no account, or one with no password
    // (Google only), counts its tries too and gets the same 429 after as many.
    const locked = () =>
      res.status(429).json({ error: "Too many failed attempts, try again later", code: "LOGIN_LOCKED" });
    const userId = await findUserIdByEmail(prisma, email);
    const user = userId ? await prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    }) : null;
    if (!user || !user.passwordHash) {
      const reserved = user ? await reserveLoginAttempt(prisma, user.id) : await reserveUnknownLoginAttempt(prisma, email);
      if (reserved === "locked") return locked();
      await bcrypt.compare(String(password), await dummyHash()); // same timing as a wrong password
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if ((await reserveLoginAttempt(prisma, user.id)) === "locked") return locked();

    // An account nobody verified answers exactly like a wrong password, right
    // password or not, and the try counts as a failure (LPBETA-23 item 5):
    // otherwise register + login with the same password would tell a new or
    // unverified email from a verified account. Whoever never verified signs
    // up again: register sends a fresh code, and verifying sets the password.
    const valid = await bcrypt.compare(String(password), user.passwordHash);
    if (!valid || !user.emailVerified) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    await clearLoginFailures(prisma, user.id);

    setAuthCookie(res, user);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        plan: user.subscription?.plan ?? "free",
        subscriptionStatus: user.subscription?.status ?? null,
        currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: user.subscription?.cancelAtPeriodEnd ?? false,
      },
    });
  } catch (err) {
    console.error("[auth/login]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user
authRouter.get("/me", async (req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { subscription: true },
    });

    if (!user) return res.status(401).json({ error: "User not found" });
    // Same rule as requireAuth (LPBETA-21): an ended session isn't signed in.
    if (!sessionVersionMatches(payload, user.tokenVersion)) return res.status(401).json({ error: "Not authenticated" });

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        plan: user.subscription?.plan ?? "free",
        subscriptionStatus: user.subscription?.status ?? null,
        currentPeriodEnd: user.subscription?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: user.subscription?.cancelAtPeriodEnd ?? false,
      },
    });
  } catch {
    return res.status(401).json({ error: "Not authenticated" });
  }
});

// Logout
authRouter.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("token", CLEAR_COOKIE_OPTS);
  res.set("Cache-Control", "no-store");
  return res.json({ success: true });
});

// Sign out on every device (LPBETA-21): bumps the session version, which ends
// every session issued before, then gives THIS device a fresh cookie with the
// new version: whoever pressed the button stays signed in here, everyone
// else (a lost phone, a shared laptop, a copied cookie) is out.
authRouter.post("/logout-all", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.authUserId! },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true, tokenVersion: true },
    });
    setAuthCookie(res, user);
    res.set("Cache-Control", "no-store");
    return res.json({ data: { ok: true } });
  } catch (err) {
    console.error("[auth/logout-all]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});
