// Gastos hormiga and subscriptions (LPBETA-12, server/lib/hormiga.ts) and the
// monthly email "Tu mes en Remanso" (server/lib/monthlyEmail.ts).
//
//   GET   /api/insights/hormiga?month=YYYY-MM  { data: { month, subscriptions, small, totals } }
//   GET   /api/insights/monthly-email          { data: { enabled } }  (my own setting)
//   PATCH /api/insights/monthly-email          { enabled } → { data: { enabled } }
//   POST  /api/insights/unsubscribe            { token } → { data: { unsubscribed: true } }
//   GET   /api/insights/cron                   the monthly send (Vercel Cron)
//
// Everything is behind requireAuth except /unsubscribe, which the email's link
// reaches without a session and is authorised by its signed token
// (server/lib/unsubscribe.ts), and /cron ("Authorization: Bearer $CRON_SECRET").
// "La quiero" / "voy a cancelarla" is PATCH /api/recurring/:id { decision }.
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthRequest } from "../middleware/auth.js";
import { serializeMoney } from "../lib/money.js";
import { periodBounds } from "../lib/period.js";
import { getCycleStartDay } from "../lib/getCycleStartDay.js";
import { expenseListingFilter } from "../lib/visibility.js";
import { loadHormiga } from "../lib/hormiga.js";
import { verifyUnsubscribeToken } from "../lib/unsubscribe.js";
import { cronAuthorized } from "../lib/banking/cron.js";
import { runMonthlyEmail } from "../lib/monthlyEmail.js";
import { sendMonthlySummaryEmail } from "../lib/mailer.js";

export const insightsRouter = Router();

// What the viewer may list only (expenseListingFilter): at shared_stats a
// member sees the subscriptions and small expenses of her own movements, and
// nobody sees a merchant that only appears on another member's private debt
// or account. A detected subscription gets its RecurringCommitment row (if the
// budget's detection hasn't made it yet) so it can be answered by id; rows
// are never updated from here, so the household's figures stay the budget's.
insightsRouter.get("/hormiga", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: "month is required (YYYY-MM)" });
    const pool = req.userId!;
    const bounds = periodBounds(month, await getCycleStartDay(pool));
    const hormiga = await loadHormiga(prisma, { poolUserId: pool, expenseWhere: await expenseListingFilter(req), bounds });

    const merchants = hormiga.subscriptions.map(s => s.merchant);
    if (merchants.length > 0) {
      await prisma.recurringCommitment.createMany({
        data: hormiga.subscriptions.map(s => ({
          userId: pool, merchant: s.merchant, avgAmount: s.amount, cadence: s.cadence,
          nextExpectedDate: s.nextExpectedDate, allocationId: s.allocationId, status: "detected",
        })),
        skipDuplicates: true,
      });
    }
    const rows = new Map((await prisma.recurringCommitment.findMany({
      where: { userId: pool, merchant: { in: merchants } },
      select: { id: true, merchant: true, decision: true, decidedAt: true },
    })).map(r => [r.merchant, r]));

    const subscriptions = hormiga.subscriptions.map(({ allocationId: _line, ...s }) => {
      const row = rows.get(s.merchant);
      return {
        ...s,
        id: row?.id ?? null,
        decision: row?.decision ?? null,
        // "Voy a cancelarla", and it was charged again after saying so.
        chargedAfterCancel: row?.decision === "cancel" && !!row.decidedAt && s.lastDate > row.decidedAt,
      };
    });
    return res.json({ data: serializeMoney({ month, subscriptions, small: hormiga.small, totals: hormiga.totals }) });
  } catch (err) {
    console.error("[insights/hormiga]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// The monthly email setting is the person's own (authUserId), never the pool's.
insightsRouter.get("/monthly-email", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await prisma.userSettings.findUnique({ where: { userId: req.authUserId! }, select: { monthlyEmailOptOut: true } });
    return res.json({ data: { enabled: !(settings?.monthlyEmailOptOut ?? false) } });
  } catch (err) {
    console.error("[insights/monthly-email GET]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

insightsRouter.patch("/monthly-email", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const enabled: unknown = req.body?.enabled;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.authUserId! },
      update: { monthlyEmailOptOut: !enabled },
      create: { userId: req.authUserId!, monthlyEmailOptOut: !enabled },
      select: { monthlyEmailOptOut: true },
    });
    return res.json({ data: { enabled: !settings.monthlyEmailOptOut } });
  } catch (err) {
    console.error("[insights/monthly-email PATCH]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// From the email's link, no session. A POST (the page asks first), so a mail
// scanner that opens every link never unsubscribes anyone. A deleted account
// has nothing left to unsubscribe: still a success.
insightsRouter.post("/unsubscribe", async (req: Request, res: Response) => {
  try {
    const userId = verifyUnsubscribeToken(req.body?.token);
    if (!userId) return res.status(400).json({ error: "Invalid link", code: "invalid_unsubscribe_token" });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (user) {
      await prisma.userSettings.upsert({
        where: { userId },
        update: { monthlyEmailOptOut: true },
        create: { userId, monthlyEmailOptOut: true },
      });
    }
    return res.json({ data: { unsubscribed: true } });
  } catch (err) {
    console.error("[insights/unsubscribe]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/insights/cron — Vercel Cron, monthly (vercel.json).
insightsRouter.get("/cron", async (req: Request, res: Response) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  if (!cronAuthorized(req.headers.authorization, process.env.CRON_SECRET)) return res.status(401).json({ error: "Not authorized" });
  try {
    const summary = await runMonthlyEmail(prisma, { now: new Date(), send: sendMonthlySummaryEmail });
    return res.json({ data: summary });
  } catch (err) {
    console.error("[insights/cron]", err instanceof Error ? err.message : "unknown error");
    return res.status(500).json({ error: "Internal server error" });
  }
});
