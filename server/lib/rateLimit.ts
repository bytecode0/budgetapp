// Rate limiting counted in the database (LPBETA-16/17). An in-memory counter
// doesn't hold on Vercel: every function instance has its own memory and a
// cold start forgets it. Here each rule has fixed windows (`windowStart` is
// the time truncated to the window), one row per key and window in
// RateLimitHit.
//
// A hit takes one unit from EVERY rule or from none: in one transaction each
// counter is incremented only while it is below its limit
// (`INSERT … ON CONFLICT DO UPDATE … WHERE count < limit RETURNING count`);
// if any rule returns no row (full), the transaction rolls back. So a refused
// request costs nothing: hammering an endpoint can't eat the daily budget
// (or someone else's) beyond what was actually allowed. The row lock taken by
// the upsert serialises parallel hits on the same key, so a burst can't all
// read "under the limit". Rules are always locked in the same order (the
// order of the checks), so two hits can't deadlock.
import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import { Prisma, type PrismaClient } from "@prisma/client";

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

export interface RateCounter {
  key: string;
  windowStart: Date;
  limit: number;
}

/** The subset of the database the limiter needs (a fake in unit tests). */
export interface RateLimitStore {
  /** Adds one to every counter if all are below their limit (true); otherwise changes nothing (false). */
  takeAll(counters: RateCounter[]): Promise<boolean>;
  /** Deletes every window that started before `before`. */
  deleteOlderThan(before: Date): Promise<void>;
}

class Full extends Error {}

export function prismaRateLimitStore(db: Pick<PrismaClient, "$transaction" | "$executeRaw">): RateLimitStore {
  return {
    async takeAll(counters) {
      try {
        await db.$transaction(async tx => {
          for (const { key, windowStart, limit } of counters) {
            if (limit < 1) throw new Full();
            const rows = await tx.$queryRaw<{ count: number }[]>(Prisma.sql`
              INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
              VALUES (${key}, ${windowStart}, 1)
              ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimitHit"."count" + 1
              WHERE "RateLimitHit"."count" < ${limit}
              RETURNING "count"`);
            if (rows.length === 0) throw new Full();
          }
        });
        return true;
      } catch (e) {
        if (e instanceof Full) return false;
        throw e;
      }
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
 * What an IP is counted as. IPv4 (also written IPv4-mapped, `::ffff:1.2.3.4`)
 * by its address; IPv6 by its /64, since one connection usually gets a whole
 * /64 and could otherwise use a fresh address per request.
 */
export function ipLimitId(ip: string): string {
  const bare = ip.trim().toLowerCase().replace(/%.*$/, ""); // drop a zone id (fe80::1%eth0)
  if (isIPv4(bare)) return bare;
  const mapped = bare.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(bare)) return bare;
  const groups = (part: string) => {
    if (!part) return [];
    return part.split(":").flatMap(g => {
      if (!isIPv4(g)) return [g];
      const [a, b, c, d] = g.split(".").map(Number);
      return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    });
  };
  const [head, tail] = bare.includes("::") ? bare.split("::") : [bare, ""];
  const h = groups(head);
  const t = groups(tail);
  const full = [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return `${full.slice(0, 4).map(g => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/**
 * Takes one hit for `id` from every rule; true when all had room. A refused
 * hit takes nothing (see the top of the file).
 */
export async function takeRateLimit(
  store: RateLimitStore,
  checks: { rule: RateRule; id: string }[],
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<boolean> {
  const allowed = await store.takeAll(checks.map(({ rule, id }) => ({
    key: rateLimitKey(rule, id),
    windowStart: windowStartOf(now, rule.windowMs),
    limit: rule.limit,
  })));
  if (random() < CLEANUP_PROBABILITY) {
    // A failed cleanup must not fail the request; the next one retries.
    await store.deleteOlderThan(new Date(now.getTime() - KEEP_MS)).catch((e) =>
      console.error("[rateLimit] cleanup failed:", e instanceof Error ? e.message : "unknown error"),
    );
  }
  return allowed;
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
    ...(ip ? [{ rule: CODE_IP_HOURLY, id: ipLimitId(ip) }, { rule: CODE_IP_DAILY, id: ipLimitId(ip) }] : []),
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
