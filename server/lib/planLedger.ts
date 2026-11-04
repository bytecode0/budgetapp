// A savings plan's balance (LifePlan.currentAmount) and its month
// contributions, kept in step (LPBETA-07 review).
//
// Per plan and month the contribution is ONE figure — the rule Home's "Te has
// pagado", GET /api/plans/monthly-status and this ledger share:
//   - with a deposit for the month (PlanDeposit, the month's total as the
//     user states it): max(deposit, booked);
//   - without one: booked, which may be negative (a withdrawal or refund on
//     the plan line takes money back out).
// booked = the net of the expenses on the plan's budget line(s) in the period.
//
// currentAmount = the plan's starting amount (+ direct contributions) + the
// sum over months of that contribution. Every write that changes a deposit or
// a plan-line expense goes through withPlanContributions(): it locks the
// affected plans (FOR UPDATE, sorted ids), measures their contributions before
// and after the write, and moves currentAmount by the difference.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { periodBounds, periodKeyFor } from "./period.js";
import { getCycleStartDay } from "./getCycleStartDay.js";
import { planContribution } from "./planContribution.js";

type Tx = Prisma.TransactionClient;
type Db = typeof prisma | Tx;

/** One plan's contribution in a month (null deposit = none registered). Pure. */
export function monthContribution(depositCents: number | null, bookedCents: number): number {
  return depositCents === null ? bookedCents : Math.max(depositCents, bookedCents);
}

/** Net booked per plan from plan-line expenses. A line not linked to a plan
 *  counts on its own (key `line:<id>`). Pure. */
export function bookedByPlan(
  rows: { lifePlanId: string | null; allocationId: string; kind?: string | null; amount: number }[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = r.lifePlanId ?? `line:${r.allocationId}`;
    out.set(key, (out.get(key) ?? 0) + planContribution(r));
  }
  return out;
}

/** Every plan's month contribution, summed: what was set aside. Pure. */
export function sumContributions(
  deposits: { planId: string; amount: number }[],
  booked: Map<string, number>,
): number {
  const deposited = new Map<string, number>();
  for (const d of deposits) deposited.set(d.planId, (deposited.get(d.planId) ?? 0) + d.amount);
  const keys = new Set([...deposited.keys(), ...booked.keys()]);
  let total = 0;
  for (const k of keys) total += monthContribution(deposited.get(k) ?? null, booked.get(k) ?? 0);
  return total;
}

/** Net booked on plan lines in the period, per plan (cents). */
export async function loadBookedByPlan(
  db: Db,
  poolUserId: string,
  bounds: { start: Date; end: Date },
  planIds?: string[],
): Promise<Map<string, number>> {
  const rows = await db.expense.findMany({
    where: {
      userId: poolUserId,
      date: { gte: bounds.start, lt: bounds.end },
      allocation: { type: "plan", ...(planIds && { lifePlanId: { in: planIds } }) },
    },
    select: { kind: true, amount: true, allocationId: true, allocation: { select: { lifePlanId: true } } },
  });
  return bookedByPlan(rows.map(r => ({
    lifePlanId: r.allocation?.lifePlanId ?? null,
    allocationId: r.allocationId!,
    kind: r.kind,
    amount: r.amount,
  })));
}

/** A plan and a period label ("YYYY-MM"). */
export interface PlanMonth { planId: string; month: string }

/** Contributions of each (plan, month), keyed `planId|month`. */
async function contributionsOf(tx: Tx, poolUserId: string, keys: PlanMonth[], cycleStartDay: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const byMonth = new Map<string, string[]>();
  for (const k of keys) byMonth.set(k.month, [...(byMonth.get(k.month) ?? []), k.planId]);
  for (const [month, planIds] of byMonth) {
    const [deposits, booked] = await Promise.all([
      tx.planDeposit.findMany({ where: { planId: { in: planIds }, month }, select: { planId: true, amount: true } }),
      loadBookedByPlan(tx, poolUserId, periodBounds(month, cycleStartDay), planIds),
    ]);
    const deposit = new Map(deposits.map(d => [d.planId, d.amount]));
    for (const planId of planIds) {
      out.set(`${planId}|${month}`, monthContribution(deposit.get(planId) ?? null, booked.get(planId) ?? 0));
    }
  }
  return out;
}

/**
 * Runs `write` (inside the caller's transaction `tx`) and moves each
 * affected plan's currentAmount by how much its month contribution changed.
 * `keys` must name every (plan, month) the write can change — for an edit,
 * both before and after. Plans are locked first, in sorted order, so
 * concurrent writes on the same plan apply one at a time.
 */
export async function withPlanContributions<T>(
  tx: Tx,
  poolUserId: string,
  keys: (PlanMonth | null)[],
  write: () => Promise<T>,
): Promise<T> {
  const unique = new Map<string, PlanMonth>();
  for (const k of keys) if (k) unique.set(`${k.planId}|${k.month}`, k);
  if (unique.size === 0) return write();

  const planIds = [...new Set([...unique.values()].map(k => k.planId))].sort();
  for (const id of planIds) await tx.$queryRaw`SELECT id FROM "LifePlan" WHERE id = ${id} FOR UPDATE`;
  const cycleStartDay = await getCycleStartDay(poolUserId);

  const before = await contributionsOf(tx, poolUserId, [...unique.values()], cycleStartDay);
  const result = await write();
  const after = await contributionsOf(tx, poolUserId, [...unique.values()], cycleStartDay);

  const delta = new Map<string, number>();
  for (const [key, k] of unique) {
    delta.set(k.planId, (delta.get(k.planId) ?? 0) + (after.get(key) ?? 0) - (before.get(key) ?? 0));
  }
  for (const id of planIds) {
    const d = delta.get(id) ?? 0;
    if (d !== 0) await tx.lifePlan.updateMany({ where: { id, userId: poolUserId }, data: { currentAmount: { increment: d } } });
  }
  return result;
}

/** The (plan, month) keys of expense rows given with their line. */
export async function planMonthsOfExpenses(
  db: Db,
  poolUserId: string,
  rows: { date: Date; allocationId: string | null }[],
): Promise<PlanMonth[]> {
  const lineIds = [...new Set(rows.map(r => r.allocationId).filter((id): id is string => !!id))];
  if (lineIds.length === 0) return [];
  const [lines, cycleStartDay] = await Promise.all([
    db.allocation.findMany({ where: { id: { in: lineIds }, userId: poolUserId, type: "plan", lifePlanId: { not: null } }, select: { id: true, lifePlanId: true } }),
    getCycleStartDay(poolUserId),
  ]);
  const planByLine = new Map(lines.map(l => [l.id, l.lifePlanId!]));
  return rows.flatMap(r => {
    const planId = r.allocationId ? planByLine.get(r.allocationId) : undefined;
    return planId ? [{ planId, month: periodKeyFor(r.date, cycleStartDay) }] : [];
  });
}
