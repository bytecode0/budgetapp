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
import { DEBTS_NONE_FLAG, computeCompleteness, findField } from "../lib/radiografia/fields/registry.v1.js";

export const radiografiaRouter = Router();

// The 4 onboarding blocks (plan §5, F3). Duplicated as a literal list on the
// client (src/radiografia/onboarding) rather than shared — crossing the
// server/src boundary isn't worth it for four ids that the plan itself fixes.
const ONBOARDING_STEPS = ["block1", "block2_email", "block3_enrichment", "result"] as const;

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

// Resolves "who is this" for endpoints reachable both before AND after email
// confirmation: the Bearer capability token (issued at /email/verify, held in
// the client's sessionStorage) takes precedence — it's what lets a returning
// tab/device without the anon cookie resume a confirmed profile. Falls back
// to the anon cookie for a profile that hasn't confirmed an email yet.
async function resolveProfile(req: Request) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const row = await prisma.radiografiaAccessToken.findUnique({ where: { token }, include: { profile: true } });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    return row.profile;
  }
  return resolveProfileFromCookie(req);
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

// GET /api/radiografia/profile — current state, resolved by cookie OR Bearer
// token. The Bearer path is what makes "resume on another device/tab" work
// (plan F3): the anon cookie never travels, the capability token does.
radiografiaRouter.get("/profile", async (req: Request, res: Response) => {
  const profile = await resolveProfile(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });
  res.json({
    data: {
      profileId: profile.id,
      onboardingStep: profile.onboardingStep,
      currency: profile.currency,
      incomeType: profile.incomeType,
      emailVerified: !!profile.emailVerifiedAt,
      email: profile.emailVerifiedAt ? profile.email : null,
    },
  });
});

// PATCH /api/radiografia/profile/step — persists which onboarding block the
// user last completed, so a refresh or a resume-elsewhere lands on the right
// screen. This is progress-position only; the actual answers for an
// unconfirmed email stay in the client's sessionStorage (plan §2.5 point 1) —
// there's nothing legitimate to persist server-side about an anonymous
// visitor beyond "how far did they get".
radiografiaRouter.patch("/profile/step", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
  const profile = await resolveProfile(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });

  const { step } = req.body ?? {};
  if (typeof step !== "string" || !(ONBOARDING_STEPS as readonly string[]).includes(step)) {
    return res.status(400).json({ error: "invalid_step" });
  }
  await prisma.financialProfile.update({ where: { id: profile.id }, data: { onboardingStep: step } });
  res.json({ data: { onboardingStep: step } });
});

interface FieldInput { key: string; valueCents: number }
interface DebtInput { kind: string; monthlyPayment: number; outstandingBalance?: number; apr?: number }

function isValidFieldInput(f: unknown): f is FieldInput {
  if (typeof f !== "object" || f === null) return false;
  const { key, valueCents } = f as Record<string, unknown>;
  if (typeof key !== "string") return false;
  const def = findField(key);
  // Derived fields (base_mensual) are never submitted directly — they're
  // computed from the fields that ARE submitted (plan §2.2).
  if (!def || def.derivableFrom) return false;
  return typeof valueCents === "number" && Number.isInteger(valueCents) && valueCents >= 0;
}

function isValidDebtInput(d: unknown): d is DebtInput {
  if (typeof d !== "object" || d === null) return false;
  const { kind, monthlyPayment, outstandingBalance, apr } = d as Record<string, unknown>;
  if (typeof kind !== "string" || !kind) return false;
  if (typeof monthlyPayment !== "number" || !Number.isInteger(monthlyPayment) || monthlyPayment < 0) return false;
  if (outstandingBalance !== undefined && (typeof outstandingBalance !== "number" || !Number.isInteger(outstandingBalance))) return false;
  if (apr !== undefined && typeof apr !== "number") return false;
  return true;
}

// POST /api/radiografia/profile/fields — Bloque 1 (plan F4): persists the
// mandatory fields + the 3 asset buckets + debts, all with source: "manual".
// Only reachable once the email is confirmed (Bearer token) OR still anon —
// same authorization as everything else here: resolveProfile(), never a
// client-supplied profileId. Re-submitting replaces the current MANUAL debts
// list wholesale (this is "save the whole form again", not an incremental
// patch) but never touches rows with source "extracto"/"derivado" — those
// keep their own provenance (principio 3).
radiografiaRouter.post("/profile/fields", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
  const profile = await resolveProfile(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });

  const { fields, debts, debtsNone } = req.body ?? {};
  if (!Array.isArray(fields) || !fields.every(isValidFieldInput)) {
    return res.status(400).json({ error: "invalid_fields" });
  }
  if (debts !== undefined && (!Array.isArray(debts) || !debts.every(isValidDebtInput))) {
    return res.status(400).json({ error: "invalid_debts" });
  }
  if (typeof debtsNone !== "boolean") return res.status(400).json({ error: "invalid_debts_none" });
  if (debtsNone && debts?.length) return res.status(400).json({ error: "debts_and_debts_none_conflict" });

  await prisma.$transaction(async tx => {
    for (const f of fields as FieldInput[]) {
      await tx.profileFieldValue.upsert({
        where: { profileId_fieldKey_source: { profileId: profile.id, fieldKey: f.key, source: "manual" } },
        create: { profileId: profile.id, fieldKey: f.key, valueCents: f.valueCents, source: "manual" },
        update: { valueCents: f.valueCents, capturedAt: new Date() },
      });
    }

    await tx.profileDebt.deleteMany({ where: { profileId: profile.id, source: "manual" } });
    if (debtsNone) {
      await tx.profileFieldValue.upsert({
        where: { profileId_fieldKey_source: { profileId: profile.id, fieldKey: DEBTS_NONE_FLAG, source: "manual" } },
        create: { profileId: profile.id, fieldKey: DEBTS_NONE_FLAG, valueCents: 1, source: "manual" },
        update: { capturedAt: new Date() },
      });
    } else {
      await tx.profileFieldValue.deleteMany({ where: { profileId: profile.id, fieldKey: DEBTS_NONE_FLAG, source: "manual" } });
      if (debts?.length) {
        await tx.profileDebt.createMany({
          data: (debts as DebtInput[]).map(d => ({
            profileId: profile.id,
            kind: d.kind,
            monthlyPayment: d.monthlyPayment,
            outstandingBalance: d.outstandingBalance ?? null,
            apr: d.apr ?? null,
            source: "manual",
          })),
        });
      }
    }
  });

  const [presentRows, debtCount] = await Promise.all([
    prisma.profileFieldValue.findMany({ where: { profileId: profile.id } }),
    prisma.profileDebt.count({ where: { profileId: profile.id } }),
  ]);
  const presentFieldKeys = new Set(presentRows.map(r => r.fieldKey));
  const completeness = computeCompleteness({
    presentFieldKeys,
    hasDebtsAnswer: presentFieldKeys.has(DEBTS_NONE_FLAG) || debtCount > 0,
  });

  res.json({ data: { completeness } });
});
