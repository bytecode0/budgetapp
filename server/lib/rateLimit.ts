// Rate limiting counted in the database (LPBETA-16/17). An in-memory counter
// doesn't hold on Vercel: every function instance has its own memory and a
// cold start forgets it. Here each rule has fixed windows (`windowStart` is
// the time truncated to the window), one row per key and window in
// RateLimitHit, and every hit is one atomic `INSERT … ON CONFLICT DO UPDATE …
// RETURNING count`: parallel requests each get a different count, so a burst
// can't all read "under the limit".
//
// Hits over the limit are counted too: someone hammering an endpoint stays
// blocked until the window ends, and the daily window keeps filling.
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

export interface RateRule {
  /** Part of the key, so two rules never share a counter. */
  name: string;
  limit: number;
  windowMs: number;
}

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Windows older than this are deleted (the longest rule is one day). */
const KEEP_MS = 2 * DAY_MS;
/** Share of hits that also delete old windows: cheap, and no cron needed. */
const CLEANUP_PROBABILITY = 0.01;

/** The subset of the Prisma client the limiter needs (a fake in unit tests). */
export interface RateLimitStore {
  /** Adds one to the counter for (key, windowStart) and returns the new count. */
  increment(key: string, windowStart: Date): Promise<number>;
  /** Deletes every window that started before `before`. */
  deleteOlderThan(before: Date): Promise<void>;
}

type RawDb = {
  $queryRaw<T>(query: Prisma.Sql): Promise<T>;
  $executeRaw(query: Prisma.Sql): Promise<number>;
};

export function prismaRateLimitStore(db: RawDb): RateLimitStore {
  return {
    async increment(key, windowStart) {
      const rows = await db.$queryRaw<{ count: number }[]>(Prisma.sql`
        INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
        VALUES (${key}, ${windowStart}, 1)
        ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
        RETURNING "count"`);
      return Number(rows[0].count);
    },
    async deleteOlderThan(before) {
      await db.$executeRaw(Prisma.sql`DELETE FROM "RateLimitHit" WHERE "windowStart" < ${before}`);
    },
  };
}

/** The start of the fixed window `now` falls in (UTC-aligned; a day starts at 00:00 UTC). */
export function windowStartOf(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/** The counter key: the rule name plus a hash, so no email or IP is stored. */
export function rateLimitKey(rule: RateRule, id: string): string {
  return `${rule.name}:${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

/**
 * Records one hit for `id` under every rule; true when all of them are still
 * within their limit. Every rule is counted even when an earlier one is over.
 */
export async function takeRateLimit(
  store: RateLimitStore,
  checks: { rule: RateRule; id: string }[],
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<boolean> {
  const counts = await Promise.all(
    checks.map(({ rule, id }) => store.increment(rateLimitKey(rule, id), windowStartOf(now, rule.windowMs))),
  );
  if (random() < CLEANUP_PROBABILITY) {
    // A failed cleanup must not fail the request; the next one retries.
    await store.deleteOlderThan(new Date(now.getTime() - KEEP_MS)).catch((e) =>
      console.error("[rateLimit] cleanup failed:", e instanceof Error ? e.message : "unknown error"),
    );
  }
  return counts.every((count, i) => count <= checks[i].rule.limit);
}

// ── The limits ─────────────────────────────────────────────────────────

// Emailed codes (register, resend-otp, send-reset; LPBETA-16). The email key
// is shared by the three routes and is the per-account daily cap: 10 codes a
// day × 5 tries each (OTP_MAX_ATTEMPTS) makes guessing a 6-digit code take
// years, and one address can't burn the email provider's daily quota. The IP
// rules stop one client from cycling through many addresses.
export const CODE_EMAIL_HOURLY: RateRule = { name: "code-email-1h", limit: 3, windowMs: HOUR_MS };
export const CODE_EMAIL_DAILY: RateRule = { name: "code-email-1d", limit: 10, windowMs: DAY_MS };
export const CODE_IP_HOURLY: RateRule = { name: "code-ip-1h", limit: 20, windowMs: HOUR_MS };
export const CODE_IP_DAILY: RateRule = { name: "code-ip-1d", limit: 50, windowMs: DAY_MS };

/** The checks for sending a code to `email` from `ip` (no IP rule when unknown). */
export function codeSendChecks(email: string, ip: string | undefined): { rule: RateRule; id: string }[] {
  const address = email.trim().toLowerCase();
  return [
    { rule: CODE_EMAIL_HOURLY, id: address },
    { rule: CODE_EMAIL_DAILY, id: address },
    ...(ip ? [{ rule: CODE_IP_HOURLY, id: ip }, { rule: CODE_IP_DAILY, id: ip }] : []),
  ];
}

// AI calls (the three import endpoints; LPBETA-17), per person: one shared
// budget, plus the tighter one suggest-mapping already had.
export const AI_HOURLY: RateRule = { name: "ai-1h", limit: 30, windowMs: HOUR_MS };
export const AI_DAILY: RateRule = { name: "ai-1d", limit: 100, windowMs: DAY_MS };
export const AI_MAPPING_HOURLY: RateRule = { name: "ai-mapping-1h", limit: 10, windowMs: HOUR_MS };

export function aiChecks(userId: string, extra: RateRule[] = []): { rule: RateRule; id: string }[] {
  return [AI_HOURLY, AI_DAILY, ...extra].map(rule => ({ rule, id: userId }));
}
