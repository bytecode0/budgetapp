// The daily bank job, run by Vercel Cron (vercel.json → GET /api/banking/cron
// with "Authorization: Bearer $CRON_SECRET"). Hobby plan: once a day.
//
//  1. Consent-expiry emails: one per consent, ~7 days before it lapses.
//  2. Sync: oldest lastSyncedAt first, one connection at a time, until the
//     time budget runs out — whatever is left goes first tomorrow. A failing
//     connection is recorded on itself and never stops the others.
// Only connections whose owner is on BANKING_ALLOWED_EMAILS are touched.
import crypto from "crypto";
import { prisma } from "../prisma.js";
import { resolveLocale } from "../email/locales/index.js";
import { sendBankConsentExpiringEmail } from "../mailer.js";
import { bankingAllowedFor } from "./config.js";
import { SYNCABLE_STATUSES, syncConnection } from "./sync.js";
import type { BankingProviderClient } from "./types.js";

/** Stop starting new connections after this long (Vercel functions time out
 *  at 60 s on Hobby without Fluid compute; one connection can take seconds). */
export const CRON_BUDGET_MS = 25_000;
export const EXPIRY_EMAIL_DAYS = 7;
/** The in-app warning shows from this many days before expiry. */
export const EXPIRY_WARNING_DAYS = 14;
const DAY_MS = 86_400_000;

/** Constant-time check of "Authorization: Bearer <CRON_SECRET>". False when
 *  the secret isn't configured. */
export function cronAuthorized(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Whether a consent expiring at `expiresAt` is due its warning email. */
export function dueExpiryEmail(c: { expiresAt: Date | null; expiryWarnedAt: Date | null }, now: Date): boolean {
  return !!c.expiresAt && !c.expiryWarnedAt && c.expiresAt > now && c.expiresAt.getTime() - now.getTime() <= EXPIRY_EMAIL_DAYS * DAY_MS;
}

async function allowedOwners(ownerIds: string[]): Promise<Map<string, { email: string; name: string | null; language: string | null }>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(ownerIds)] } },
    select: { id: true, email: true, name: true, settings: { select: { language: true } } },
  });
  const out = new Map<string, { email: string; name: string | null; language: string | null }>();
  for (const u of users) {
    if (u.email && bankingAllowedFor(u.email)) out.set(u.id, { email: u.email, name: u.name, language: u.settings?.language ?? null });
  }
  return out;
}

export interface CronSummary {
  warned: number;
  synced: number;
  failed: number;
  remaining: number;
}

export async function runBankingCron(client: BankingProviderClient, opts: { now?: Date; budgetMs?: number; clock?: () => number } = {}): Promise<CronSummary> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? CRON_BUDGET_MS;
  const summary: CronSummary = { warned: 0, synced: 0, failed: 0, remaining: 0 };

  // 1. Expiry warnings.
  const expiring = await prisma.bankConnection.findMany({
    where: { status: { in: SYNCABLE_STATUSES }, expiryWarnedAt: null, expiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRY_EMAIL_DAYS * DAY_MS) } },
    select: { id: true, ownerUserId: true, institutionName: true, expiresAt: true, expiryWarnedAt: true },
  });
  const warnOwners = await allowedOwners(expiring.map(c => c.ownerUserId));
  for (const c of expiring) {
    const owner = warnOwners.get(c.ownerUserId);
    if (!owner || !dueExpiryEmail(c, now)) continue;
    try {
      await sendBankConsentExpiringEmail(owner.email, owner.name ?? "", c.institutionName, c.expiresAt!, resolveLocale(owner.language));
      await prisma.bankConnection.update({ where: { id: c.id }, data: { expiryWarnedAt: now } });
      summary.warned++;
    } catch (err) {
      console.error(`[banking/cron] expiry email for connection ${c.id} failed:`, err instanceof Error ? err.message : "unknown error");
    }
  }

  // 2. Sync, oldest first.
  const connections = await prisma.bankConnection.findMany({
    where: { status: { in: SYNCABLE_STATUSES } },
    orderBy: [{ lastSyncedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, ownerUserId: true },
  });
  const syncOwners = await allowedOwners(connections.map(c => c.ownerUserId));
  const todo = connections.filter(c => syncOwners.has(c.ownerUserId));
  for (const [i, c] of todo.entries()) {
    if (clock() - started >= budget) { summary.remaining = todo.length - i; break; }
    try {
      const result = await syncConnection(client, c.id, now);
      if (result.ok) summary.synced++; else summary.failed++;
    } catch (err) {
      summary.failed++;
      console.error(`[banking/cron] connection ${c.id} crashed:`, err instanceof Error ? err.name : "unknown error");
    }
  }
  return summary;
}
