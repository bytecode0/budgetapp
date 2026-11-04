// Active-users count for the BETA (LPBETA-05, docs/vision-y-plan-beta.md §3).
//
// An active user has done something in the app in the last 30 days: entered
// an expense or an income (by hand or a file import), made or changed a plan
// deposit, or reviewed bank movements. What the daily bank sync writes on its own
// (source "bank_sync", and the Account.bankReviewedAt cursor it advances) is
// not the person's activity; their review is, via User.lastBankReviewAt.
//
// Counts only: nothing here reads or returns names, emails, amounts or
// descriptions. The loader selects ids and dates; the report is numbers.
import type { PrismaClient } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActivityInput {
  users: { id: string; createdAt: Date }[];
  // One entry per (user, moment) something was done; several per user is fine.
  activity: { userId: string; at: Date }[];
  // Plans per owner, and deposits per owner (the plan's owner).
  planOwners: string[];
  deposits: { userId: string; at: Date }[];
  // Member count of each household.
  householdSizes: number[];
}

export interface CohortRow { weekStart: string; registered: number; active30: number }

export interface ActiveStats {
  registered: { total: number; last7: number; last30: number };
  active: { last7: number; last30: number };
  householdsOfTwo: number;
  withPlan: number;
  depositedLast30: number;
  cohorts: CohortRow[]; // oldest first
}

// Monday (UTC) of the week a date falls in, as YYYY-MM-DD.
export function weekStart(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(day.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export function computeActiveStats(input: ActivityInput, now: Date): ActiveStats {
  const since = (days: number) => now.getTime() - days * DAY_MS;
  const known = new Set(input.users.map(u => u.id));

  const activeSince = (days: number) => {
    const ids = new Set<string>();
    for (const a of input.activity) {
      if (known.has(a.userId) && a.at.getTime() >= since(days)) ids.add(a.userId);
    }
    return ids;
  };
  const active7 = activeSince(7);
  const active30 = activeSince(30);

  const cohorts = new Map<string, CohortRow>();
  for (const u of input.users) {
    const key = weekStart(u.createdAt);
    const row = cohorts.get(key) ?? { weekStart: key, registered: 0, active30: 0 };
    row.registered += 1;
    if (active30.has(u.id)) row.active30 += 1;
    cohorts.set(key, row);
  }

  const depositors = new Set(
    input.deposits.filter(d => known.has(d.userId) && d.at.getTime() >= since(30)).map(d => d.userId),
  );

  return {
    registered: {
      total: input.users.length,
      last7: input.users.filter(u => u.createdAt.getTime() >= since(7)).length,
      last30: input.users.filter(u => u.createdAt.getTime() >= since(30)).length,
    },
    active: { last7: active7.size, last30: active30.size },
    householdsOfTwo: input.householdSizes.filter(n => n >= 2).length,
    withPlan: new Set(input.planOwners.filter(id => known.has(id))).size,
    depositedLast30: depositors.size,
    cohorts: [...cohorts.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
  };
}

// Reads only ids and dates. Rows from before per-person attribution existed
// (Expense.createdByUserId, PlanDeposit.byUserId, LifePlan.ownerUserId null)
// count for the pool's owner (userId) or the plan's owner, the best that is
// known about them. Editing an expense or income is not counted: nothing
// records who edited it, and automated updates move updatedAt too.
export async function loadActivity(prisma: PrismaClient, now: Date): Promise<ActivityInput> {
  const from = new Date(now.getTime() - 30 * DAY_MS);
  const [users, expenses, incomes, reviewers, plans, deposits, households] = await Promise.all([
    prisma.user.findMany({ select: { id: true, createdAt: true } }),
    prisma.expense.groupBy({
      by: ["userId", "createdByUserId"],
      where: { createdAt: { gte: from }, source: { not: "bank_sync" } },
      _max: { createdAt: true },
    }),
    prisma.income.groupBy({
      by: ["ownerUserId"],
      where: { createdAt: { gte: from }, source: { not: "bank_sync" } },
      _max: { createdAt: true },
    }),
    prisma.user.findMany({ where: { lastBankReviewAt: { gte: from } }, select: { id: true, lastBankReviewAt: true } }),
    prisma.lifePlan.findMany({ select: { userId: true, ownerUserId: true } }),
    // updatedAt: changing this month's deposit is activity too (upsert by month).
    prisma.planDeposit.findMany({
      where: { updatedAt: { gte: from } },
      select: { userId: true, byUserId: true, updatedAt: true, plan: { select: { ownerUserId: true } } },
    }),
    prisma.householdMember.groupBy({ by: ["householdId"], _count: { userId: true } }),
  ]);

  const activity: ActivityInput["activity"] = [];
  for (const e of expenses) if (e._max.createdAt) activity.push({ userId: e.createdByUserId ?? e.userId, at: e._max.createdAt });
  for (const i of incomes) if (i._max.createdAt) activity.push({ userId: i.ownerUserId, at: i._max.createdAt });
  for (const r of reviewers) if (r.lastBankReviewAt) activity.push({ userId: r.id, at: r.lastBankReviewAt });
  const depositRows = deposits.map(d => ({ userId: d.byUserId ?? d.plan.ownerUserId ?? d.userId, at: d.updatedAt }));
  activity.push(...depositRows);

  return {
    users,
    activity,
    planOwners: plans.map(p => p.ownerUserId ?? p.userId),
    deposits: depositRows,
    householdSizes: households.map(h => h._count.userId),
  };
}

const pct = (part: number, whole: number) => (whole > 0 ? ` (${Math.round((part / whole) * 100)} %)` : "");

export function formatActiveStats(s: ActiveStats, now: Date): string {
  const lines = [
    `Remanso — usuarios activos a ${now.toISOString().slice(0, 10)}`,
    "",
    `Registrados:   ${s.registered.total} en total · ${s.registered.last7} en 7 días · ${s.registered.last30} en 30 días`,
    `Activos:       ${s.active.last7} en 7 días · ${s.active.last30} en 30 días${pct(s.active.last30, s.registered.total)}`,
    `Hogares de 2:  ${s.householdsOfTwo}`,
    `Con un plan:   ${s.withPlan} · con una aportación en 30 días: ${s.depositedLast30}`,
    "",
    "Retención por semana de alta (activos en 30 días / registrados esa semana):",
    ...(s.cohorts.length === 0
      ? ["  (nadie registrado todavía)"]
      : s.cohorts.map(c => `  semana del ${c.weekStart}: ${c.active30}/${c.registered}${pct(c.active30, c.registered)}`)),
  ];
  return lines.join("\n");
}
