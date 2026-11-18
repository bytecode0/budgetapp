// "Tu mes en Remanso" (LPBETA-12): the monthly email, run by Vercel Cron
// (vercel.json → GET /api/insights/cron on the 1st, "Authorization: Bearer
// $CRON_SECRET").
//
// For each person with a verified email who hasn't turned it off
// (UserSettings.monthlyEmailOptOut) and whose account isn't being deleted:
// the budget period that just ended (their household's payday), summed up as
// they would see it in the app — what the household paid itself (pool
// totals, as on Home), and their subscriptions and gastos hormiga over the
// movements THEY may list (server/lib/visibility.ts), so a partner's private
// rows never reach their email. Totals and counts only, no merchant names.
// Nothing to say (no subscriptions, no small expenses, nothing set aside and
// no goal) → no email.
//
// Idempotent: UserSettings.monthlyEmailSentPeriod records the period sent, so
// a re-run (a retry, or a manual call after a run that stopped at the time
// budget or the send cap) only sends to whoever is still missing it. The cap
// keeps one run well under Resend's free 100 emails a day, leaving room for
// sign-in codes.
import type { PrismaClient } from "@prisma/client";
import { resolveLocale, type EmailLocale } from "./email/locales/index.js";
import { getTheme } from "./email/theme.js";
import type { MonthlySummaryData } from "./email/templates/index.js";
import { loadHormiga } from "./hormiga.js";
import { monthSavings } from "./payYourselfFirst.js";
import { clampCycleStartDay, currentPeriodKey, periodBounds, periodKeyOffset } from "./period.js";
import { unsubscribeUrl } from "./unsubscribe.js";
import { expenseListingFilter } from "./visibility.js";

export const MONTHLY_EMAIL_BUDGET_MS = 25_000;
export const MONTHLY_EMAIL_MAX_SENDS = 80;
const CURRENCY = "EUR"; // households are in euros (Household.baseCurrency)

export type SendMonthlySummary = (email: string, data: MonthlySummaryData, locale: EmailLocale) => Promise<void>;

export interface MonthlyEmailSummary {
  sent: number;
  skipped: number;   // nothing to say this month
  failed: number;
  remaining: number; // not reached: time budget or send cap
}

/** The period that ended most recently for a household paid on `cycleStartDay`. */
export function lastEndedPeriod(cycleStartDay: number, now: Date): string {
  return periodKeyOffset(currentPeriodKey(cycleStartDay, now), -1);
}

export async function runMonthlyEmail(
  db: PrismaClient,
  opts: { now?: Date; send: SendMonthlySummary; budgetMs?: number; maxSends?: number; clock?: () => number },
): Promise<MonthlyEmailSummary> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? MONTHLY_EMAIL_BUDGET_MS;
  const maxSends = opts.maxSends ?? MONTHLY_EMAIL_MAX_SENDS;
  const summary: MonthlyEmailSummary = { sent: 0, skipped: 0, failed: 0, remaining: 0 };

  const people = await db.user.findMany({
    where: {
      email: { not: null },
      emailVerified: { not: null },
      deletionRequestedAt: null,
      OR: [{ settings: { is: null } }, { settings: { is: { monthlyEmailOptOut: false } } }],
    },
    select: {
      id: true, email: true, name: true,
      settings: { select: { language: true, linkedUserId: true, monthlyEmailSentPeriod: true } },
      householdMemberships: { where: { status: "active" }, select: { householdId: true }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const [i, person] of people.entries()) {
    if (clock() - started >= budget || summary.sent + summary.failed >= maxSends) {
      summary.remaining = people.length - i;
      break;
    }
    try {
      // The same scope requireAuth gives this person's requests.
      const viewer = {
        authUserId: person.id,
        userId: person.settings?.linkedUserId ?? person.id,
        householdId: person.householdMemberships[0]?.householdId,
      };
      const pool = await db.userSettings.findUnique({ where: { userId: viewer.userId }, select: { cycleStartDay: true } });
      const period = lastEndedPeriod(clampCycleStartDay(pool?.cycleStartDay ?? 1), now);
      if (person.settings?.monthlyEmailSentPeriod === period) continue;
      const bounds = periodBounds(period, clampCycleStartDay(pool?.cycleStartDay ?? 1));

      const [hormiga, savings] = await Promise.all([
        loadHormiga(db, { poolUserId: viewer.userId, expenseWhere: await expenseListingFilter(viewer), bounds, now }),
        monthSavings(viewer.userId, period, bounds),
      ]);
      const nothing = hormiga.subscriptions.length === 0 && hormiga.small.length === 0
        && savings.paidYourself === 0 && savings.payYourselfFirstGoal === null;
      if (nothing) { summary.skipped++; continue; }

      const locale = resolveLocale(person.settings?.language);
      const { totals } = hormiga;
      await opts.send(person.email!, {
        name: person.name ?? "",
        period,
        currency: CURRENCY,
        subscriptionsCount: hormiga.subscriptions.length,
        subscriptionsMonthly: totals.subscriptionsMonthly,
        subscriptionsYearly: totals.subscriptionsYearly,
        smallCount: hormiga.small.length,
        smallTotal: totals.smallTotal,
        smallYearly: totals.smallYearly,
        halfYearly: totals.halfYearly,
        priceRises: hormiga.subscriptions.filter(s => s.previousAmount !== null).length,
        paidYourself: savings.paidYourself,
        payYourselfGoal: savings.payYourselfFirstApplies ? savings.payYourselfFirstGoal : null,
        unsubscribeUrl: unsubscribeUrl(getTheme().appUrl, person.id, locale),
      }, locale);
      await db.userSettings.upsert({
        where: { userId: person.id },
        update: { monthlyEmailSentPeriod: period },
        create: { userId: person.id, monthlyEmailSentPeriod: period },
      });
      summary.sent++;
    } catch (err) {
      summary.failed++;
      console.error(`[insights/cron] monthly email for user ${person.id} failed:`, err instanceof Error ? err.message : "unknown error");
    }
  }
  return summary;
}
