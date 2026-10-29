import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "../lib/prisma.js";
import { signToken, verifyToken } from "../lib/jwt.js";
import { generateOtp, hashOtp, verifyOtp } from "../lib/otp.js";
import { createDefaultAllocations } from "../lib/defaults.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  sendWelcomeGoogleEmail,
} from "../lib/mailer.js";
import { parseLocale, resolveLocale } from "../lib/email/locales/index.js";

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
const GOOGLE_EXCHANGE_PURPOSE = "google_exchange";

export function createGoogleSession(userId: string): string {
  return signToken({ purpose: GOOGLE_EXCHANGE_PURPOSE, sub: userId }, "2m");
}

/** The userId inside a valid, unexpired exchange token; null otherwise. */
export function readGoogleSession(token: string): string | null {
  try {
    const payload = verifyToken(token);
    if (payload?.purpose !== GOOGLE_EXCHANGE_PURPOSE || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
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

function setAuthCookie(res: Response, userId: string) {
  const token = signToken({ userId });
  res.cookie("token", token, COOKIE_OPTS);
}

// ── Google OAuth ──────────────────────────────────────────────

authRouter.get("/google", (req: Request, res: Response) => {
  const googleClient = newGoogleClient();
  if (!googleClient) return res.status(503).json({ error: "Google sign-in is not configured" });
  // The UI language (?lang=es|en) rides in `state` so a new user's settings are
  // created in it. It is not a secret and is re-validated on the way back.
  const lang = parseLocale(req.query.lang);
  const url = googleClient.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account",
    ...(lang && { state: lang }),
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

  if (error || !code) {
    return res.redirect(`${appUrl}/?error=google_denied`);
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

    if (!data.email) {
      return res.redirect(`${appUrl}/?error=google_no_email`);
    }

    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    const isNewUser = !existingUser;

    const user = await prisma.user.upsert({
      where: { email: data.email },
      update: {
        emailVerified: data.verified_email ? new Date() : undefined,
        image: data.picture,
      },
      create: {
        email: data.email,
        name: data.name,
        image: data.picture,
        emailVerified: data.verified_email ? new Date() : null,
      },
    });

    if (isNewUser) {
      const locale = parseLocale(state) ?? undefined;
      sendWelcomeGoogleEmail(user.email!, user.name ?? "", locale).catch((e) =>
        console.error("[auth/google/callback] welcome google email failed:", e)
      );
      createDefaultAllocations(user.id, locale).catch((e) =>
        console.error("[auth/google/callback] createDefaultAllocations failed:", e)
      );
    }

    const sessionToken = createGoogleSession(user.id);
    return res.redirect(`${appUrl}/auth/google/callback?token=${sessionToken}`);
  } catch (err) {
    console.error("[auth/google/callback]", err);
    return res.redirect(`${appUrl}/?error=google_failed`);
  }
});

authRouter.post("/google/exchange", async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) return res.status(400).json({ error: "Token is required" });

  const sessionUserId = typeof token === "string" ? readGoogleSession(token) : null;
  if (!sessionUserId) {
    return res.status(400).json({ error: "Invalid or expired session token" });
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    include: { subscription: true },
  });

  if (!user) return res.status(400).json({ error: "User not found" });

  setAuthCookie(res, user.id);

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

// Register
authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, language } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email and password are required" });
    }

    // Optional: the UI language at sign-up, used for the verification email and
    // saved to UserSettings below (createDefaultAllocations keeps it on verify).
    const locale = language === undefined ? "es" : parseLocale(language);
    if (!locale) {
      return res.status(400).json({ error: "language must be 'es' or 'en'" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing?.emailVerified) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = existing
      ? await prisma.user.update({ where: { email }, data: { name, passwordHash } })
      : await prisma.user.create({ data: { name, email, passwordHash } });
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: { language: locale },
      create: { userId: user.id, monthlyIncome: 0, language: locale },
    });

    const otp = await createOtp(email, "email_verification");
    await sendVerificationEmail(email, name, otp, locale);

    return res.json({ message: "Verification email sent" });
  } catch (err) {
    console.error("[auth/register]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Verify email OTP
authRouter.post("/verify-email", async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required" });
    }

    const record = await prisma.otpToken.findFirst({
      where: { email, type: "email_verification", used: false },
      orderBy: { createdAt: "desc" },
    });

    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ error: "Code expired or invalid" });
    }

    if (!verifyOtp(otp, record.tokenHash)) {
      return res.status(400).json({ error: "Incorrect code" });
    }

    await prisma.otpToken.update({ where: { id: record.id }, data: { used: true } });

    const user = await prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
      include: { settings: { select: { language: true } } },
    });

    setAuthCookie(res, user.id);

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

// Resend OTP
authRouter.post("/resend-otp", async (req: Request, res: Response) => {
  try {
    const { email, type } = req.body;

    if (!email || !type) {
      return res.status(400).json({ error: "Email and type are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { settings: { select: { language: true } } },
    });
    if (!user) {
      return res.json({ message: "If an account exists, a new code was sent" });
    }

    const last = await prisma.otpToken.findFirst({
      where: { email, type, used: false },
      orderBy: { createdAt: "desc" },
    });

    if (last && last.createdAt > new Date(Date.now() - 60_000)) {
      return res.status(429).json({ error: "Wait before requesting a new code" });
    }

    const otp = await createOtp(email, type);

    const locale = resolveLocale(user.settings?.language);
    if (type === "email_verification") {
      await sendVerificationEmail(email, user.name ?? "", otp, locale);
    } else if (type === "password_reset") {
      await sendPasswordResetEmail(email, otp, locale);
    }

    return res.json({ message: "Code sent" });
  } catch (err) {
    console.error("[auth/resend-otp]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Send password reset OTP
authRouter.post("/send-reset", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { settings: { select: { language: true } } },
    });
    if (!user) {
      return res.json({ message: "If an account exists, a reset code was sent" });
    }

    const otp = await createOtp(email, "password_reset");
    await sendPasswordResetEmail(email, otp, resolveLocale(user.settings?.language));

    return res.json({ message: "Reset code sent" });
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

    const record = await prisma.otpToken.findFirst({
      where: { email, type: "password_reset", used: false },
      orderBy: { createdAt: "desc" },
    });

    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ error: "Code expired or invalid" });
    }

    if (!verifyOtp(otp, record.tokenHash)) {
      return res.status(400).json({ error: "Incorrect code" });
    }

    await prisma.otpToken.update({ where: { id: record.id }, data: { used: true } });

    const resetToken = signToken({ email, type: "password_reset" }, "15m");
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

    if (payload.type !== "password_reset" || !payload.email) {
      return res.status(400).json({ error: "Invalid reset token" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { email: payload.email }, data: { passwordHash } });

    return res.json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("[auth/reset-password]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Login
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { subscription: true },
    });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Please verify your email before signing in",
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    setAuthCookie(res, user.id);

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
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  res.set("Cache-Control", "no-store");
  return res.json({ success: true });
});
