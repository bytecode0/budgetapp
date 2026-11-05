// The person's own account (LPBETA-09): export my data, delete my account.
// Every route acts on req.authUserId (the real person), never on the pool,
// and is behind requireAuth — except /cron, the daily purge, which Vercel Cron
// calls with "Authorization: Bearer $CRON_SECRET" (vercel.json).
//
//   GET    /api/account/export            JSON file: my records (accountExport.ts)
//   GET    /api/account/export/movements  CSV file: my movements
//   GET    /api/account/deletion          { data: { requestedAt, dueAt } | null }
//   POST   /api/account/deletion/code     emails a confirmation code
//   POST   /api/account/deletion          { code } → marks the account (24 h grace)
//   DELETE /api/account/deletion          cancels the request (409 while the purge runs)
//   GET    /api/account/cron              the daily purge (accountDeletion.ts)
//
// The two exports are file downloads, so their success body is the file
// itself, not { data }; errors are { error, code } as everywhere.
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { consumeOtp, generateOtp, hashOtp } from "../lib/otp.js";
import { resolveLocale } from "../lib/email/locales/index.js";
import {
  sendAccountDeletedEmail, sendAccountDeletionCodeEmail, sendAccountDeletionRequestedEmail,
} from "../lib/mailer.js";
import { EXPORT_MAX_BYTES, buildJsonExport, buildMovementRows, movementsCsv } from "../lib/accountExport.js";
import { deletionDueAt, isLockNotAvailable, runDeletionPurge } from "../lib/accountDeletion.js";
import { cronAuthorized } from "../lib/banking/cron.js";
import { getBankingClient } from "../lib/banking/enableBanking.js";
import { getStripe, isBillingEnabled } from "../lib/stripe.js";

export const accountRouter = Router();

export const DELETION_OTP_TYPE = "account_deletion";
const OTP_TTL_MS = 15 * 60 * 1000;
/** Same pace as POST /api/auth/resend-otp: one new code a minute. */
const OTP_RESEND_MS = 60_000;

const TOO_LARGE = { error: "Your export is too large to download here: write to support", code: "export_too_large" };

function exportFilename(kind: "json" | "csv", now = new Date()): string {
  return `remanso-${kind === "json" ? "datos" : "movimientos"}-${now.toISOString().slice(0, 10)}.${kind}`;
}

function sendFile(res: Response, body: string, type: string, filename: string) {
  if (Buffer.byteLength(body) > EXPORT_MAX_BYTES) return res.status(413).json(TOO_LARGE);
  res.set({
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  return res.send(body);
}

accountRouter.get("/export", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const doc = await buildJsonExport(prisma, req.authUserId!);
    return sendFile(res, JSON.stringify(doc, null, 1), "application/json", exportFilename("json"));
  } catch (err) {
    console.error("[account/export]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

accountRouter.get("/export/movements", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const csv = movementsCsv(await buildMovementRows(prisma, req.authUserId!));
    return sendFile(res, csv, "text/csv", exportFilename("csv"));
  } catch (err) {
    console.error("[account/export/movements]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

function deletionState(requestedAt: Date | null) {
  return requestedAt ? { requestedAt, dueAt: deletionDueAt(requestedAt) } : null;
}

accountRouter.get("/deletion", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.authUserId! }, select: { deletionRequestedAt: true } });
    return res.json({ data: deletionState(user?.deletionRequestedAt ?? null) });
  } catch (err) {
    console.error("[account/deletion]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

accountRouter.post("/deletion/code", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.authUserId! },
      select: { email: true, settings: { select: { language: true } } },
    });
    if (!user?.email) return res.status(400).json({ error: "Your account has no email", code: "no_email" });

    const last = await prisma.otpToken.findFirst({
      where: { email: user.email, type: DELETION_OTP_TYPE, used: false },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (last && last.createdAt > new Date(Date.now() - OTP_RESEND_MS)) {
      return res.status(429).json({ error: "Wait before requesting a new code", code: "otp_wait" });
    }

    await prisma.otpToken.deleteMany({ where: { email: user.email, type: DELETION_OTP_TYPE } });
    const otp = generateOtp();
    await prisma.otpToken.create({
      data: { email: user.email, type: DELETION_OTP_TYPE, tokenHash: hashOtp(otp), expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    await sendAccountDeletionCodeEmail(user.email, otp, resolveLocale(user.settings?.language));
    return res.json({ data: { sent: true } });
  } catch (err) {
    console.error("[account/deletion/code]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

accountRouter.post("/deletion", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const me = req.authUserId!;
    const user = await prisma.user.findUnique({
      where: { id: me },
      select: { email: true, name: true, deletionRequestedAt: true, settings: { select: { language: true } } },
    });
    if (!user?.email) return res.status(400).json({ error: "Your account has no email", code: "no_email" });
    // Already asked: nothing to confirm again, the original date stands.
    if (user.deletionRequestedAt) return res.json({ data: deletionState(user.deletionRequestedAt) });

    const result = await consumeOtp(prisma, user.email, DELETION_OTP_TYPE, String(req.body?.code ?? ""));
    if (result !== "ok") {
      return result === "incorrect"
        ? res.status(400).json({ error: "Incorrect code", code: "otp_incorrect" })
        : res.status(400).json({ error: "Code expired or invalid, request a new one", code: "otp_invalid" });
    }

    // Only the first request sets the date (a double submit keeps it).
    const now = new Date();
    await prisma.user.updateMany({ where: { id: me, deletionRequestedAt: null }, data: { deletionRequestedAt: now } });
    const { deletionRequestedAt } = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { deletionRequestedAt: true } });

    // The email is the receipt and the way back, but the request stands without it.
    try {
      await sendAccountDeletionRequestedEmail(user.email, user.name ?? "", deletionDueAt(deletionRequestedAt!), resolveLocale(user.settings?.language));
    } catch (err) {
      console.error("[account/deletion] requested email failed:", err instanceof Error ? err.message : "unknown error");
    }
    return res.json({ data: deletionState(deletionRequestedAt) });
  } catch (err) {
    console.error("[account/deletion]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Once the daily job has claimed the account (deletionStartedAt, set under
// the row lock), cancelling answers 409 instead of half-happening. NOWAIT
// gives the same answer while a claim or data step holds the lock.
const IN_PROGRESS = { error: "Your account is being deleted right now", code: "deletion_in_progress" };
accountRouter.delete("/deletion", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const cancelled = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${req.authUserId!} FOR UPDATE NOWAIT`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: req.authUserId! }, select: { deletionStartedAt: true } });
      if (user.deletionStartedAt) return false;
      await tx.user.update({ where: { id: req.authUserId! }, data: { deletionRequestedAt: null } });
      return true;
    });
    if (!cancelled) return res.status(409).json(IN_PROGRESS);
    return res.json({ data: null });
  } catch (err) {
    if (isLockNotAvailable(err)) {
      return res.status(409).json(IN_PROGRESS);
    }
    console.error("[account/deletion/cancel]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** Deletes the Stripe customer, which also cancels its subscriptions at
 *  once. Already deleted counts as done, so a retry never blocks on it. A
 *  short timeout and no retries: the purge must fit the cron's time budget. */
async function deleteStripeCustomerNow(customerId: string): Promise<void> {
  try {
    await getStripe().customers.del(customerId, undefined, { timeout: 8_000, maxNetworkRetries: 0 });
  } catch (err) {
    if ((err as { code?: string })?.code === "resource_missing") return;
    throw err;
  }
}

// GET /api/account/cron — Vercel Cron, daily (vercel.json). Authenticated by
// "Authorization: Bearer $CRON_SECRET", not by a user session.
accountRouter.get("/cron", async (req: Request, res: Response) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "Not authorized" });
  try {
    const summary = await runDeletionPurge(prisma, {
      now: new Date(),
      banking: getBankingClient(), // unattended: no PSU headers; null when banking is off
      deleteStripeCustomer: isBillingEnabled() ? deleteStripeCustomerNow : null,
      sendDeletedEmail: sendAccountDeletedEmail,
    });
    return res.json({ data: summary });
  } catch (err) {
    console.error("[account/cron]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});
