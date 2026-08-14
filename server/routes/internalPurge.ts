// Real retention purge (plan §4.4) — replaces "nothing ever deletes these
// rows" with an actual job. Authenticated by a shared secret header, same
// pattern as POST /api/banking/sync-all: the caller is a scheduler (Render
// Cron, OS cron via curl), not a browser, so requireAuth doesn't apply.
// Always mounted — unlike the BudgetApp routers, this purges Radiografía
// tables that accumulate regardless of VITE_ENABLE_BUDGETAPP.
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";

export const internalPurgeRouter = Router();

const UNVERIFIED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — no email confirmed at all
const INCOMPLETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — email confirmed, onboarding never finished

internalPurgeRouter.post("/purge", async (req: Request, res: Response) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  if (req.headers["x-cron-secret"] !== secret) return res.status(401).json({ error: "Not authorized" });

  const now = new Date();
  const [expiredSessions, unverifiedProfiles, incompleteVerifiedProfiles] = await Promise.all([
    // The XRaySession "processed and deleted" promise (plan §4.1) only holds
    // if something actually deletes past-TTL rows — nothing did until now.
    prisma.xRaySession.deleteMany({ where: { expiresAt: { lt: now } } }),
    // Never confirmed an email at all — the shortest leash, since there's no
    // proof this was ever a real person, not just an abandoned first screen.
    prisma.financialProfile.deleteMany({
      where: {
        emailVerifiedAt: null,
        onboardingCompletedAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - UNVERIFIED_RETENTION_MS) },
      },
    }),
    // Confirmed an email but never finished onboarding — a real lead, longer
    // retention, but still purged if truly abandoned (never a completed
    // radiografía, which this condition explicitly excludes).
    prisma.financialProfile.deleteMany({
      where: {
        emailVerifiedAt: { not: null },
        onboardingCompletedAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - INCOMPLETE_RETENTION_MS) },
      },
    }),
  ]);

  res.json({
    data: {
      expiredXraySessions: expiredSessions.count,
      unverifiedProfilesPurged: unverifiedProfiles.count,
      incompleteVerifiedProfilesPurged: incompleteVerifiedProfiles.count,
    },
  });
});
