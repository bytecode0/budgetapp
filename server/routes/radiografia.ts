// Radiografía onboarding — profile bootstrap + email confirmation, WITHOUT
// identity (docs/plan-onboarding-radiografia.md §0.2, §2.3, §2.5). No
// session, no password, no login. Two separate resolution mechanisms exist
// on purpose:
//   - `radiografia_anon` httpOnly cookie: the ONLY way to resolve "who is
//     this" before an email is confirmed. Never trust a client-supplied
//     profileId for authorization — it's fine for informational lookups
//     only, after the cookie has already resolved the true owner.
//   - RadiografiaAccessToken: an opaque capability scoped to ONE profile,
//     returned in the response body (not a cookie) once the email is
//     confirmed. The client holds it in sessionStorage. It authenticates
//     "this radiografía", never "this person".
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import {
  generateCode,
  generateSalt,
  hashCode,
  verifyCode,
  generateAccessToken,
  generateAnonId,
  EMAIL_CHECK_TTL_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
} from "../lib/radiografia/emailCheck.js";
import { sendRadiografiaEmailCode } from "../lib/mailer.js";

export const radiografiaRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ANON_COOKIE = "radiografia_anon";
const ANON_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  maxAge: 400 * 24 * 60 * 60 * 1000, // just an opaque lookup key, not a session — long-lived is harmless
};

// DB-backed (email, IP, window) rate limit — replaces the in-memory `Map`
// pattern used elsewhere (server/routes/xray.ts), which is per-process, has
// no eviction, and can't see across restarts. Codes are a brute-force
// target, so the limit has to survive a redeploy.
const REQUEST_RATE_WINDOW_MS = 60 * 60 * 1000; // 1h
const REQUEST_RATE_MAX = 5; // email/request calls per (email, ip) per window

// Baseline per-IP abuse guard on every endpoint here, same shape as
// server/routes/xray.ts's `hits` map — coarse and in-memory, but this is
// on top of (not instead of) the DB-backed limit above for email/request.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 30;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_MAX;
}
function clientIp(req: Request): string {
  return req.ip || "unknown";
}

async function resolveProfileFromCookie(req: Request) {
  const anonId = req.cookies?.[ANON_COOKIE];
  if (typeof anonId !== "string" || !anonId) return null;
  return prisma.financialProfile.findUnique({ where: { anonId } });
}

// POST /api/radiografia/profile — bootstrap or resume an anonymous profile.
radiografiaRouter.post("/profile", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });

  const existing = await resolveProfileFromCookie(req);
  if (existing) {
    return res.json({
      data: {
        profileId: existing.id,
        onboardingStep: existing.onboardingStep,
        currency: existing.currency,
        incomeType: existing.incomeType,
        emailVerified: !!existing.emailVerifiedAt,
      },
    });
  }

  const { currency, incomeType, origen } = req.body ?? {};
  const profile = await prisma.financialProfile.create({
    data: {
      anonId: generateAnonId(),
      currency: typeof currency === "string" && currency ? currency : undefined,
      incomeType: incomeType === "irregular" ? "irregular" : undefined,
      origen: typeof origen === "string" ? origen.slice(0, 100) : undefined,
    },
  });
  res.cookie(ANON_COOKIE, profile.anonId, ANON_COOKIE_OPTS);
  res.json({
    data: {
      profileId: profile.id,
      onboardingStep: profile.onboardingStep,
      currency: profile.currency,
      incomeType: profile.incomeType,
      emailVerified: false,
    },
  });
});

// POST /api/radiografia/email/request — send a 6-digit code to confirm an
// email. Authorization is the anon cookie, never req.body.profileId.
radiografiaRouter.post("/email/request", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });

  const profile = await resolveProfileFromCookie(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });

  const { email: rawEmail } = req.body ?? {};
  if (typeof rawEmail !== "string" || !EMAIL_RE.test(rawEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const email = rawEmail.trim().toLowerCase();
  const ip = clientIp(req);

  const [lastForProfile, recentForEmailIp] = await Promise.all([
    prisma.radiografiaEmailCheck.findFirst({
      where: { profileId: profile.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.radiografiaEmailCheck.count({
      where: { email, requestIp: ip, createdAt: { gt: new Date(Date.now() - REQUEST_RATE_WINDOW_MS) } },
    }),
  ]);

  if (lastForProfile && Date.now() - lastForProfile.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: "resend_cooldown" });
  }
  if (recentForEmailIp >= REQUEST_RATE_MAX) {
    return res.status(429).json({ error: "rate_limited" });
  }

  const code = generateCode();
  const salt = generateSalt();
  await prisma.radiografiaEmailCheck.create({
    data: {
      profileId: profile.id,
      email,
      codeHash: hashCode(code, salt),
      salt,
      requestIp: ip,
      expiresAt: new Date(Date.now() + EMAIL_CHECK_TTL_MS),
    },
  });

  try {
    await sendRadiografiaEmailCode(email, code);
  } catch (err) {
    console.error("[radiografia/email/request] send failed", err);
    return res.status(502).json({ error: "send_failed" });
  }

  res.json({ data: { sentTo: email, expiresInSeconds: EMAIL_CHECK_TTL_MS / 1000 } });
});

// POST /api/radiografia/email/verify — consumes the latest pending code for
// the cookie-resolved profile. On success, merges into any pre-existing
// profile that already owns this email (plan §2.5) and issues a capability
// token — never a session.
radiografiaRouter.post("/email/verify", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });

  const profile = await resolveProfileFromCookie(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });

  const { code } = req.body ?? {};
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "invalid_code" });
  }

  const check = await prisma.radiografiaEmailCheck.findFirst({
    where: { profileId: profile.id, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!check) return res.status(404).json({ error: "no_pending_code" });
  if (check.attemptCount >= MAX_ATTEMPTS) return res.status(400).json({ error: "too_many_attempts" });
  if (check.expiresAt.getTime() < Date.now()) return res.status(400).json({ error: "code_expired" });

  if (!verifyCode(code, check.salt, check.codeHash)) {
    await prisma.radiografiaEmailCheck.update({
      where: { id: check.id },
      data: { attemptCount: { increment: 1 } },
    });
    return res.status(400).json({ error: "wrong_code" });
  }

  const finalProfileId = await prisma.$transaction(async tx => {
    await tx.radiografiaEmailCheck.update({ where: { id: check.id }, data: { consumedAt: new Date() } });

    const existingOwner = await tx.financialProfile.findUnique({ where: { email: check.email } });
    if (!existingOwner || existingOwner.id === profile.id) {
      await tx.financialProfile.update({
        where: { id: profile.id },
        data: { email: check.email, emailVerifiedAt: new Date() },
      });
      return profile.id;
    }

    // Merge: existingOwner is the canonical profile for this email (principio
    // 1, un solo perfil canónico). Field values move over only where the
    // target doesn't already have that (fieldKey, source) — never overwrite,
    // per-field provenance is preserved either way.
    const [movingValues, targetKeys] = await Promise.all([
      tx.profileFieldValue.findMany({ where: { profileId: profile.id } }),
      tx.profileFieldValue.findMany({ where: { profileId: existingOwner.id } }),
    ]);
    const targetKeySet = new Set(targetKeys.map(v => `${v.fieldKey}|${v.source}`));
    const toMove = movingValues.filter(v => !targetKeySet.has(`${v.fieldKey}|${v.source}`));
    if (toMove.length) {
      await tx.profileFieldValue.createMany({
        data: toMove.map(v => ({
          profileId: existingOwner.id,
          fieldKey: v.fieldKey,
          valueCents: v.valueCents,
          source: v.source,
          capturedAt: v.capturedAt,
        })),
      });
    }
    await tx.profileDebt.updateMany({ where: { profileId: profile.id }, data: { profileId: existingOwner.id } });
    if (!existingOwner.emailVerifiedAt) {
      await tx.financialProfile.update({ where: { id: existingOwner.id }, data: { emailVerifiedAt: new Date() } });
    }
    await tx.financialProfile.delete({ where: { id: profile.id } });
    return existingOwner.id;
  });

  const token = generateAccessToken();
  await prisma.radiografiaAccessToken.create({
    data: { token, profileId: finalProfileId, scope: "radiografia" },
  });

  res.clearCookie(ANON_COOKIE, ANON_COOKIE_OPTS);
  res.json({ data: { profileId: finalProfileId, accessToken: token, email: check.email } });
});
