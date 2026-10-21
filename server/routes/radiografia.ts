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
import { sendRadiografiaEmailCode, sendRadiografiaReportEmail, sendEbookEmail } from "../lib/mailer.js";
import { DEBTS_NONE_FLAG, findField, FIELD_REGISTRY_VERSION } from "../lib/radiografia/fields/registry.v1.js";
import { recalculateStage } from "../lib/radiografia/stage/recalculate.js";
import { STAGE_CONFIG_V1 } from "../lib/radiografia/stage/config.v1.js";
import { buildRadiografiaEmailReport, type RadiografiaSnapshot, type InsightNames } from "../lib/radiografia/report.js";
import { buildRadiografiaSnapshot, buildInsightNames, withInsightNames, MAX_INSIGHT_NAMES } from "../lib/radiografia/snapshot.js";
import type { StageId } from "../lib/radiografia/stage/engine.js";
import { parseFile, dedupeTxns, filesFromBody } from "../lib/xray/parseUpload.js";
import { analyze, type XRayResult } from "../lib/xray/analyze.js";

export const radiografiaRouter = Router();

// The 4 onboarding blocks (plan §5, F3). Duplicated as a literal list on the
// client (src/radiografia/onboarding) rather than shared — crossing the
// server/src boundary isn't worth it for four ids that the plan itself fixes.
const ONBOARDING_STEPS = ["upload", "context", "email", "result"] as const;

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

// `names` — merchant names handed in by the caller. Passed on /email/verify,
// absent on /report/resend, which no longer matters: verify persists them into
// the snapshot, so a resend (and the permanent report) read them back from
// there even after this session's sessionStorage is gone.
// `accessToken` becomes the "view it again" link in the email footer.
interface DeliverReportResult {
  delivered: boolean;
  // Radiografia.id — the permanent web report's token (GET /report/:token),
  // a DIFFERENT token from the RadiografiaAccessToken passed in as
  // `accessToken`. Returned so the client can link straight to the rich
  // report on screen, not just inside an email that might never arrive.
  reportToken: string | null;
}

async function deliverReport(profileId: string, email: string, accessToken: string | null, names?: InsightNames): Promise<DeliverReportResult> {
  const stageResult = await recalculateStage(profileId, "manual");
  const [profile, radiografia] = await Promise.all([
    prisma.financialProfile.findUnique({
      where: { id: profileId },
      include: { fieldValues: true, debts: true },
    }),
    prisma.radiografia.findUnique({ where: { profileId_version: { profileId, version: 1 } } }),
  ]);
  const reportToken = radiografia?.id ?? null;
  if (!profile) return { delivered: false, reportToken };

  const report = buildRadiografiaEmailReport({
    fieldValues: profile.fieldValues,
    debts: profile.debts,
    incomeType: profile.incomeType,
    stageId: stageResult.stage.stageId,
    branchId: stageResult.stage.branchId,
    snapshot: (radiografia?.resultado as unknown as RadiografiaSnapshot) ?? null,
    names,
  });
  try {
    await sendRadiografiaReportEmail(email, report, accessToken, reportToken);
    return { delivered: true, reportToken };
  } catch (err) {
    // Email confirmation succeeded; do not invalidate it because a mail
    // provider is temporarily unavailable. The report/resend route retries
    // this exact delivery with the verified capability token.
    console.error("[radiografia/report] delivery failed", err);
    return { delivered: false, reportToken };
  }
}

// Persists the analysis-derived part of the report (Radiografia.resultado) —
// the only place `analyze()`'s output survives past this request, since raw
// transactions are never stored (plan §4.1). The shaping/filtering logic
// (health excluded, subscriptions vs. housing/debt) lives in the pure
// server/lib/radiografia/snapshot.ts so it can be unit-tested without
// pulling in mailer.ts's live Resend client. Upserted on (profileId,
// version=1): a corrected re-upload overwrites the same row rather than
// creating a parallel history, which this product has no use for yet (v2:
// recalcular está fuera de scope, scope-release.md).
async function writeRadiografiaSnapshot(profileId: string, result: XRayResult, stageId: string | null, origen: string | null): Promise<void> {
  const snapshot = buildRadiografiaSnapshot(result);

  await prisma.radiografia.upsert({
    where: { profileId_version: { profileId, version: 1 } },
    create: {
      id: generateAccessToken(),
      profileId,
      version: 1,
      resultado: snapshot as unknown as object,
      stageAtComputation: stageId,
      frameworkVersion: FIELD_REGISTRY_VERSION,
      engineConfigVersion: STAGE_CONFIG_V1.version,
      origen,
    },
    update: {
      resultado: snapshot as unknown as object,
      stageAtComputation: stageId,
      computedAt: new Date(),
    },
  });
}

// Writes the merchant names into an existing snapshot. Called at exactly one
// point — /email/verify, once the code has checked out — because that is the
// first moment the consent given at the email step is backed by a confirmed
// address. Best-effort by design: a profile with no snapshot has nothing to
// annotate, and a failure here must never undo an email confirmation that
// already succeeded.
async function persistInsightNames(profileId: string, names: InsightNames): Promise<void> {
  const radiografia = await prisma.radiografia.findUnique({
    where: { profileId_version: { profileId, version: 1 } },
  });
  if (!radiografia) return;
  const annotated = withInsightNames(radiografia.resultado as unknown as RadiografiaSnapshot, names);
  await prisma.radiografia.update({
    where: { id: radiografia.id },
    data: { resultado: annotated as unknown as object },
  });
}

// Structural validation only (count/length) — max 5 of each, name capped so
// a hostile client can't puff up the email or the stored snapshot with them.
// HTML-escaping happens at the point of interpolation, in mailer.ts's
// template; the web report renders them as text, never as markup.
function sanitizeInsightNames(raw: unknown): InsightNames | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const clean = (list: unknown, withCount: boolean) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && typeof x.merchant === "string" && !!x.merchant)
      .slice(0, MAX_INSIGHT_NAMES)
      .map((x) => withCount
        ? { merchant: String(x.merchant).slice(0, 40), count: typeof x.count === "number" && Number.isFinite(x.count) ? x.count : 1 }
        : { merchant: String(x.merchant).slice(0, 40) });
  };
  return { ant: clean(r.ant, true) as InsightNames["ant"], recurring: clean(r.recurring, false) as InsightNames["recurring"] };
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

// Whether this profile has ever had a statement successfully analyzed.
// /profile/extracto always writes at least one ProfileFieldValue with
// source: "extracto" on success (income_regular, even if the amount is 0),
// so its existence is a reliable signal — unlike the client's own
// sessionStorage, which is lost on a device switch or can be pre-existing
// from before the statement became mandatory. This is what gates resuming
// past the upload step (A3): the server, not the browser, decides whether
// someone has actually provided a statement.
async function profileHasExtracto(profileId: string): Promise<boolean> {
  const row = await prisma.profileFieldValue.findFirst({ where: { profileId, source: "extracto" } });
  return !!row;
}

// Anonymous funnel/brand counters for the future owner dashboard (data
// foundation only — no UI yet). Both tables have no profileId and no
// relation to FinancialProfile on purpose: they must survive
// internalPurge.ts and DELETE /api/radiografia/profile untouched, which is
// only possible because there's nothing in them that could identify anyone.
// Fire-and-forget: a failure here must never break the real user-facing
// request it's attached to, so callers never await these inline with
// anything that would surface the error to the response.
function recordFunnelEvent(event: string, paso: number | null, origen: string | null): void {
  prisma.radiografiaFunnelEvent.create({ data: { event, paso, origen } }).catch((err) => {
    console.error("[radiografia/funnel]", err);
  });
}

function recordBrandInsights(names: InsightNames, origen: string | null): void {
  const rows = [
    ...names.ant.map((n) => ({ kind: "ant", brand: n.merchant, origen })),
    ...names.recurring.map((n) => ({ kind: "subscription", brand: n.merchant, origen })),
  ];
  if (!rows.length) return;
  prisma.radiografiaBrandInsight.createMany({ data: rows }).catch((err) => {
    console.error("[radiografia/brand-insight]", err);
  });
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
        hasExtracto: await profileHasExtracto(existing.id),
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
      hasExtracto: false,
    },
  });
});

// POST /api/radiografia/email/request — send a 6-digit code to confirm an
// email. Authorization is the anon cookie, never req.body.profileId.
radiografiaRouter.post("/email/request", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });

  const profile = await resolveProfileFromCookie(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });

  const { email: rawEmail, consentReport } = req.body ?? {};
  if (typeof rawEmail !== "string" || !EMAIL_RE.test(rawEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  // Explicit consent is the legal basis for sending the report, so it is
  // enforced here and not only in the UI — a client that omits the box gets no
  // code at all. Marketing consent stays a separate, independent decision
  // (consentMarketingAt); this endpoint never sets it.
  if (consentReport !== true) {
    return res.status(400).json({ error: "consent_required" });
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

  // Stamped only when still null, so the record keeps the moment consent was
  // first given rather than the last time a code was re-requested.
  await prisma.financialProfile.updateMany({
    where: { id: profile.id, consentReportAt: null },
    data: { consentReportAt: new Date() },
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

  const { code, names } = req.body ?? {};
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "invalid_code" });
  }
  const insightNames = sanitizeInsightNames(names);

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
    // 1, un solo perfil canónico). The arriving profile is the FRESH run — it
    // has just been through the (mandatory) statement upload and the context
    // step — so it wins: every `source` it brings at least one row of is
    // replaced wholesale in the target. The previous rule ("move only what the
    // target doesn't already have") meant a second radiografía for the same
    // email silently kept the first capture's figures and discarded the ones
    // the person had just corrected.
    //
    // Replacing per-source rather than per-fieldKey is also what clears a
    // stale DEBTS_NONE_FLAG: it's a ProfileFieldValue with source "manual", so
    // an old run's "no tengo deudas" must not survive next to a new run's
    // debts. Rows with source "derivado" are recomputed by recalculateStage()
    // in deliverReport() a few lines below, so they need no special handling.
    const movingValues = await tx.profileFieldValue.findMany({ where: { profileId: profile.id } });
    const movingValueSources = [...new Set(movingValues.map(v => v.source))];
    if (movingValueSources.length) {
      await tx.profileFieldValue.deleteMany({
        where: { profileId: existingOwner.id, source: { in: movingValueSources } },
      });
      await tx.profileFieldValue.createMany({
        data: movingValues.map(v => ({
          profileId: existingOwner.id,
          fieldKey: v.fieldKey,
          valueCents: v.valueCents,
          source: v.source,
          capturedAt: v.capturedAt,
        })),
      });
    }

    // Same rule for debts — and here the deleteMany is what stops them
    // ACCUMULATING: moving the rows over without clearing the target's rows of
    // the same source left the canonical profile holding BOTH runs' debts,
    // which doubles debtPressure and can push a stage classification over a
    // threshold that was never crossed.
    const movingDebts = await tx.profileDebt.findMany({ where: { profileId: profile.id }, select: { source: true } });
    const movingDebtSources = [...new Set(movingDebts.map(d => d.source))];
    if (movingDebtSources.length) {
      await tx.profileDebt.deleteMany({ where: { profileId: existingOwner.id, source: { in: movingDebtSources } } });
      await tx.profileDebt.updateMany({ where: { profileId: profile.id }, data: { profileId: existingOwner.id } });
    }

    // Radiografia has onDelete: Cascade on profile, so the delete below used
    // to destroy the snapshot /profile/extracto had just computed for this
    // session, while the canonical profile kept whatever it already had —
    // often nothing at all, for a profile created before snapshots existed.
    // The result was reportToken: null and a result screen with no report to
    // show, permanently, for that email: the same person retrying (even in a
    // private window) landed on the same empty canonical profile every time.
    //
    // The target's row keeps its id, because that id IS the permanent report
    // URL — links already sent by email stay alive and now render fresh data.
    // ebookSentAt is deliberately not reset: a refreshed report must not
    // re-trigger the eBook for someone who already received it.
    const [movingReport, targetReport] = await Promise.all([
      tx.radiografia.findUnique({ where: { profileId_version: { profileId: profile.id, version: 1 } } }),
      tx.radiografia.findUnique({ where: { profileId_version: { profileId: existingOwner.id, version: 1 } } }),
    ]);
    if (movingReport && targetReport) {
      await tx.radiografia.update({
        where: { id: targetReport.id },
        data: {
          resultado: movingReport.resultado as object,
          stageAtComputation: movingReport.stageAtComputation,
          computedAt: movingReport.computedAt,
          frameworkVersion: movingReport.frameworkVersion,
          engineConfigVersion: movingReport.engineConfigVersion,
          origen: movingReport.origen ?? targetReport.origen,
        },
      });
    } else if (movingReport) {
      await tx.radiografia.update({ where: { id: movingReport.id }, data: { profileId: existingOwner.id } });
    }

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

  if (insightNames) {
    try {
      await persistInsightNames(finalProfileId, insightNames);
    } catch (err) {
      // The report still gets the names for THIS delivery (they're passed to
      // deliverReport below); only the permanent copy is lost.
      console.error("[radiografia/insightNames] persist failed", err);
    }
  }

  const { delivered: reportSent, reportToken } = await deliverReport(finalProfileId, check.email, token, insightNames);
  await prisma.financialProfile.update({
    where: { id: finalProfileId },
    data: { onboardingStep: "result", onboardingCompletedAt: new Date() },
  });

  // Both true at this exact instant: the email just got confirmed (métrica 3,
  // "% que deja el email por el informe") and the result screen is what
  // renders next (métrica 2). Fired here regardless of `reportSent` — a mail
  // provider hiccup doesn't undo that the person confirmed their email.
  recordFunnelEvent("radiografia_completada", null, profile.origen);
  recordFunnelEvent("email_capturado", null, profile.origen);

  res.clearCookie(ANON_COOKIE, ANON_COOKIE_OPTS);
  // `reportToken` lets the on-screen result link straight to the rich report
  // (categories, gastos hormiga, gráficos) even if the email never arrives —
  // it must not be something a person can only reach by receiving mail.
  res.json({ data: { profileId: finalProfileId, accessToken: token, email: check.email, reportSent, reportToken } });
});

// POST /api/radiografia/report/resend — retries the transactional delivery
// after a temporary mail-provider failure. The verified, profile-scoped token
// is required; knowing an email address is never sufficient.
radiografiaRouter.post("/report/resend", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
  const profile = await resolveProfile(req);
  if (!profile?.emailVerifiedAt || !profile.email) return res.status(404).json({ error: "profile_not_found" });

  const authHeader = req.headers.authorization;
  const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  const { delivered, reportToken } = await deliverReport(profile.id, profile.email, bearerToken);
  if (!delivered) return res.status(502).json({ error: "send_failed" });
  res.json({ data: { delivered: true, reportToken } });
});

// GET /api/radiografia/report/:token — the permanent web version of the
// report, per the criterio in scope-release.md ("enlace permanente... en
// URL con token no adivinable"). Public and unauthenticated on purpose: the
// token IS the capability, the exact same trust model RadiografiaAccessToken
// already uses elsewhere in this router — knowing the 32-byte token is what
// authorizes the read, nothing else does. Merchant names come from the
// snapshot itself, written at /email/verify; health and giving are not in it
// to be read.
radiografiaRouter.get("/report/:token", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
  const { token } = req.params;
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(404).json({ error: "not_found" });
  }

  const radiografia = await prisma.radiografia.findUnique({
    where: { id: token },
    include: { profile: { include: { fieldValues: true, debts: true } } },
  });
  if (!radiografia) return res.status(404).json({ error: "not_found" });

  const report = buildRadiografiaEmailReport({
    fieldValues: radiografia.profile.fieldValues,
    debts: radiografia.profile.debts,
    incomeType: radiografia.profile.incomeType,
    stageId: radiografia.profile.stageCache as StageId | null,
    snapshot: radiografia.resultado as unknown as RadiografiaSnapshot,
  });

  // Fires the eBook email the first time this report is actually opened —
  // atomically: the WHERE clause only matches while ebookSentAt is still
  // null, so a refresh, a second tab, or two near-simultaneous requests for
  // the same token can only ever have ONE of them win this update and send.
  // `profile.email` is never null here: there is no way to hold a valid
  // reportToken without having already confirmed an email (see
  // OnboardingFlow/EmailBlock — the token only ever reaches the client after
  // /email/verify succeeds).
  const { count } = await prisma.radiografia.updateMany({
    where: { id: token, ebookSentAt: null },
    data: { ebookSentAt: new Date() },
  });
  if (count === 1 && radiografia.profile.email) {
    sendEbookEmail(radiografia.profile.email).catch((err) => console.error("[radiografia/ebook]", err));
  }

  res.json({ data: report });
});

// GET /api/radiografia/profile — current state, resolved by cookie OR Bearer
// token. The Bearer path is what makes "resume on another device/tab" work
// (plan F3): the anon cookie never travels, the capability token does.
radiografiaRouter.get("/profile", async (req: Request, res: Response) => {
  const profile = await resolveProfile(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });
  // Refreshing the browser at the result step must still land on a working
  // link to the rich report — it can't only ever come from the response of
  // the one-time /email/verify call.
  const radiografia = profile.emailVerifiedAt
    ? await prisma.radiografia.findUnique({ where: { profileId_version: { profileId: profile.id, version: 1 } }, select: { id: true } })
    : null;
  res.json({
    data: {
      profileId: profile.id,
      onboardingStep: profile.onboardingStep,
      currency: profile.currency,
      incomeType: profile.incomeType,
      emailVerified: !!profile.emailVerifiedAt,
      email: profile.emailVerifiedAt ? profile.email : null,
      stageId: profile.stageCache,
      hasExtracto: await profileHasExtracto(profile.id),
      reportToken: radiografia?.id ?? null,
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

  // Counts each checkpoint (paso) at most once per profile, using the
  // high-water mark — NOT `profile.onboardingStep` itself. onboardingStep
  // moves backward on "volver al extracto", so comparing against it would
  // re-fire the same paso_completado every time someone goes back and
  // forward again; maxOnboardingStepReached never decreases, so a revisit
  // never looks like fresh progress. `paso` is 1-indexed over the server's 4
  // tracked blocks (upload/context/email/result) — coarser than the
  // on-screen progress bar, which also shows a client-only "review" screen
  // inside the upload step.
  const newIdx = ONBOARDING_STEPS.indexOf(step as (typeof ONBOARDING_STEPS)[number]);
  const paso = newIdx + 1;
  const isNewHighWater = paso > profile.maxOnboardingStepReached;

  await prisma.financialProfile.update({
    where: { id: profile.id },
    data: { onboardingStep: step, ...(isNewHighWater ? { maxOnboardingStepReached: paso } : {}) },
  });
  if (isNewHighWater) recordFunnelEvent("paso_completado", paso, profile.origen);
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

  const { completeness, stage } = await recalculateStage(
    profile.id,
    profile.stageCache === null ? "new_radiografia" : "threshold_cross",
  );

  res.json({ data: { completeness, stage: { stageId: stage.stageId, branchId: stage.branchId, classifiable: stage.classifiable } } });
});

const EXTRACTO_MAX_FILES = 5;
const EXTRACTO_MAX_TXNS = 5000;

// POST /api/radiografia/profile/extracto — Bloque 3 (plan F11, brought
// forward from "flagged/waitlist"): the optional bank-statement step. Reuses
// the SAME parser + analyze() pipeline as the live /api/xray/analyze — that
// pipeline stays the one place statement analysis happens, per the plan's own
// "reutilizar, no reconstruir" call for analyze.ts.
//
// Deliberately does NOT persist an XRaySession or any raw transaction row:
// unlike the live flow, this onboarding has no reclassify/add-account step
// yet that would need them, so there's nothing to keep them for. Only
// aggregates ever reach ProfileFieldValue/ProfileDebt (source: "extracto") —
// stricter than plan §4.1's own 60-minute workspace, since here there's no
// workspace at all.
radiografiaRouter.post("/profile/extracto", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });
  const profile = await resolveProfile(req);
  if (!profile) return res.status(404).json({ error: "profile_not_found" });
  // Captured before this analysis writes anything, so brand insights only
  // get recorded on someone's FIRST successful statement — a correction/
  // re-upload still updates the real snapshot below, just doesn't count its
  // brands a second time in the anonymous table (see RadiografiaBrandInsight's
  // schema comment for why this can't be de-duplicated after the fact).
  const isFirstExtracto = !(await profileHasExtracto(profile.id));

  const files = filesFromBody(req.body);
  if (!files) return res.status(400).json({ error: "missing_file" });
  if (files.length > EXTRACTO_MAX_FILES) return res.status(400).json({ error: "too_many_files" });

  let merged: Awaited<ReturnType<typeof parseFile>>["txns"] = [];
  let anyReadable = false;
  for (let i = 0; i < files.length; i++) {
    const { txns, bank } = await parseFile(files[i], i);
    if (bank !== "unreadable") anyReadable = true;
    if (txns.length) merged.push(...txns);
  }
  if (merged.length === 0) return res.status(422).json({ error: anyReadable ? "unrecognized_format" : "unreadable_file" });

  merged = dedupeTxns(merged);
  if (merged.length > EXTRACTO_MAX_TXNS) return res.status(413).json({ error: "too_many_transactions" });

  const result = analyze(merged);
  const months = result.period.months;
  const toCents = (euros: number) => Math.round(euros * 100);

  const fields: FieldInput[] = [
    { key: "income_regular", valueCents: toCents(result.summary.totalIncome / months) },
    { key: "saving_monthly", valueCents: toCents(result.wealth.savings / months) },
    { key: "investment_monthly", valueCents: toCents(result.wealth.investment / months) },
    { key: "giving_monthly", valueCents: toCents(result.wealth.giving / months) },
  ];
  if (result.balances.hasData) {
    fields.push({ key: "account_balance", valueCents: toCents(result.balances.total) });
  }

  const debts: DebtInput[] = result.debts.items.map((d) => ({ kind: d.kind, monthlyPayment: toCents(d.monthlyAmount) }));
  if (result.debts.mortgage?.detected) {
    debts.push({ kind: "mortgage", monthlyPayment: toCents(result.debts.mortgage.monthlyAmount) });
  }

  await prisma.$transaction(async (tx) => {
    for (const f of fields) {
      await tx.profileFieldValue.upsert({
        where: { profileId_fieldKey_source: { profileId: profile.id, fieldKey: f.key, source: "extracto" } },
        create: { profileId: profile.id, fieldKey: f.key, valueCents: f.valueCents, source: "extracto" },
        update: { valueCents: f.valueCents, capturedAt: new Date() },
      });
    }
    await tx.profileDebt.deleteMany({ where: { profileId: profile.id, source: "extracto" } });
    if (debts.length) {
      await tx.profileDebt.createMany({
        data: debts.map((d) => ({ profileId: profile.id, kind: d.kind, monthlyPayment: d.monthlyPayment, source: "extracto" })),
      });
    }
  });

  const { completeness, stage } = await recalculateStage(
    profile.id,
    profile.stageCache === null ? "new_radiografia" : "threshold_cross",
  );

  await writeRadiografiaSnapshot(profile.id, result, stage.branchId ?? stage.stageId, profile.origen);

  // Kept in the browser (sessionStorage) until /email/verify, where consent
  // exists and they're written into the snapshot. Nothing is stored with a
  // merchant name attached before that point. See buildInsightNames' comment
  // for what's excluded.
  const insightNames = buildInsightNames(result);
  if (isFirstExtracto) recordBrandInsights(insightNames, profile.origen);

  res.json({
    data: {
      completeness,
      stage: { stageId: stage.stageId, branchId: stage.branchId, classifiable: stage.classifiable },
      detected: {
        months,
        transactionCount: result.summary.transactionCount,
        monthlyIncome: eurRound(result.summary.totalIncome / months),
        monthlyExpenses: eurRound(result.summary.totalExpenses / months),
        savingMonthly: eurRound(result.wealth.savings / months),
        investmentMonthly: eurRound(result.wealth.investment / months),
        accountBalance: result.balances.hasData ? eurRound(result.balances.total) : null,
        debtsCount: debts.length,
      },
      insightNames,
    },
  });
});

function eurRound(n: number): number {
  return Math.round(n * 100) / 100;
}

// DELETE /api/radiografia/profile — borrado a petición (plan §4.5). Requires
// the Bearer capability token, never just "I know the email" — the token is
// already proof the email was confirmed by OTP once, which is a stronger bar
// than the plan's minimum ("no basta con conocer el email"), so this doesn't
// need a second, parallel OTP flow just for deletion. The anon cookie is
// deliberately NOT accepted here: an unconfirmed, cookie-only profile has
// nothing worth an explicit delete flow for — it already ages out via the
// 7-day purge (/api/internal/purge).
radiografiaRouter.delete("/profile", async (req: Request, res: Response) => {
  if (rateLimited(clientIp(req))) return res.status(429).json({ error: "rate_limited" });

  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "access_token_required" });
  }
  const token = authHeader.slice("Bearer ".length);
  const row = await prisma.radiografiaAccessToken.findUnique({ where: { token } });
  if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) {
    return res.status(404).json({ error: "profile_not_found" });
  }

  await prisma.financialProfile.delete({ where: { id: row.profileId } });
  res.json({ data: { deleted: true } });
});
