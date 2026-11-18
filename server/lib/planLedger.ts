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
// Writes that can touch any month of a plan at once — deleting or relinking a
// plan line, a couple unlinking (server/lib/partnerUnlink.ts) — go through
// withPlanTotals() instead: same idea, over every month of the plan.
// Deleting a plan line keeps what it contributed (decided by Luis, 18 nov):
// keepLineContributions() first freezes each month it would lower as that
// month's deposit, so the delete moves nothing (see there).
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { clampCycleStartDay, periodBounds, periodKeyFor } from "./period.js";
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

/** The plans a write measured were read before its transaction and a plan
 *  line changed since (relinked, deleted, out of the plan type): the caller
 *  retries with fresh reads (retryOnStalePlans). */
export class StalePlanKeys extends Error {
  constructor() { super("A plan line changed while writing; retry"); }
}

/** The answer when the retries run out (409, server/lib/planLedger.ts). */
export const PLAN_LINE_CHANGED = { error: "A plan budget line changed at the same time; try again", code: "plan_line_changed" };

/** Runs `attempt` again (fresh reads, new transaction) while it throws
 *  StalePlanKeys, up to `tries` times; then the error goes to the caller. */
export async function retryOnStalePlans<T>(attempt: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!(err instanceof StalePlanKeys) || i >= tries) throw err;
    }
  }
}

/**
 * Runs `write` (inside the caller's transaction `tx`) and moves each
 * affected plan's currentAmount by how much its month contribution changed.
 * `keys` must name every (plan, month) the write can change — for an edit,
 * both before and after. Plans are locked first, in sorted order, so
 * concurrent writes on the same plan apply one at a time.
 *
 * `recheck`: the expense rows `keys` were computed from, outside the
 * transaction. Once the plans are locked their lines are locked FOR KEY SHARE
 * (a relink takes them FOR UPDATE after its plans, routes/allocations.ts) and
 * the keys recomputed; a key that wasn't measured throws StalePlanKeys.
 */
export async function withPlanContributions<T>(
  tx: Tx,
  poolUserId: string,
  keys: (PlanMonth | null)[],
  write: () => Promise<T>,
  recheck?: { rows: { date: Date; allocationId: string | null }[] },
): Promise<T> {
  const unique = new Map<string, PlanMonth>();
  for (const k of keys) if (k) unique.set(`${k.planId}|${k.month}`, k);

  const planIds = [...new Set([...unique.values()].map(k => k.planId))].sort();
  for (const id of planIds) await tx.$queryRaw`SELECT id FROM "LifePlan" WHERE id = ${id} FOR UPDATE`;
  if (recheck) {
    const lineIds = [...new Set(recheck.rows.map(r => r.allocationId).filter((id): id is string => !!id))].sort();
    if (lineIds.length > 0) await tx.$queryRaw`SELECT id FROM "Allocation" WHERE id = ANY(${lineIds}::text[]) FOR KEY SHARE`;
    const fresh = await planMonthsOfExpenses(tx, poolUserId, recheck.rows);
    if (fresh.some(k => !unique.has(`${k.planId}|${k.month}`))) throw new StalePlanKeys();
  }
  if (unique.size === 0) return write();
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

/** Each plan's contributions summed over every month (cents), from its
 *  deposits and its booked rows (already placed in a month). Pure. */
export function totalContributions(
  deposits: { planId: string; month: string; amount: number }[],
  booked: { planId: string; month: string; kind?: string | null; amount: number }[],
): Map<string, number> {
  const deposit = new Map<string, number>();
  const net = new Map<string, number>();
  for (const d of deposits) deposit.set(`${d.planId}|${d.month}`, (deposit.get(`${d.planId}|${d.month}`) ?? 0) + d.amount);
  for (const b of booked) net.set(`${b.planId}|${b.month}`, (net.get(`${b.planId}|${b.month}`) ?? 0) + planContribution(b));
  const out = new Map<string, number>();
  for (const key of new Set([...deposit.keys(), ...net.keys()])) {
    const planId = key.slice(0, key.indexOf("|"));
    out.set(planId, (out.get(planId) ?? 0) + monthContribution(deposit.get(key) ?? null, net.get(key) ?? 0));
  }
  return out;
}

/** Each plan's contributions over every month, read in the plan's own scope
 *  (LifePlan.userId) with that scope's budget period. */
async function contributionTotalsOf(tx: Tx, planIds: string[]): Promise<Map<string, number>> {
  const plans = await tx.lifePlan.findMany({ where: { id: { in: planIds } }, select: { id: true, userId: true } });
  const byScope = new Map<string, string[]>();
  for (const p of plans) byScope.set(p.userId, [...(byScope.get(p.userId) ?? []), p.id]);
  const out = new Map<string, number>();
  for (const [userId, ids] of byScope) {
    // The budget period read in the transaction: the write may change it
    // (an account deletion hands the pool's period to the partner).
    const [settings, deposits, expenses] = await Promise.all([
      tx.userSettings.findUnique({ where: { userId }, select: { cycleStartDay: true } }),
      tx.planDeposit.findMany({ where: { planId: { in: ids } }, select: { planId: true, month: true, amount: true } }),
      tx.expense.findMany({
        where: { userId, allocation: { type: "plan", lifePlanId: { in: ids } } },
        select: { date: true, kind: true, amount: true, allocation: { select: { lifePlanId: true } } },
      }),
    ]);
    const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
    const booked = expenses.map(e => ({
      planId: e.allocation!.lifePlanId!, month: periodKeyFor(e.date, cycleStartDay), kind: e.kind, amount: e.amount,
    }));
    for (const [id, total] of totalContributions(deposits, booked)) out.set(id, total);
  }
  return out;
}

/**
 * Runs `write` (inside the caller's transaction `tx`) and moves each plan's
 * currentAmount by how much its contributions over every month changed. For
 * writes that can change any month of a plan, or move it to another scope:
 * a plan line deleted or linked to another plan, a couple unlinking. Plans
 * are locked first, in sorted order, as in withPlanContributions().
 */
export async function withPlanTotals<T>(tx: Tx, planIds: (string | null)[], write: () => Promise<T>): Promise<T> {
  const ids = [...new Set(planIds.filter((id): id is string => !!id))].sort();
  if (ids.length === 0) return write();
  for (const id of ids) await tx.$queryRaw`SELECT id FROM "LifePlan" WHERE id = ${id} FOR UPDATE`;
  const before = await contributionTotalsOf(tx, ids);
  const result = await write();
  const after = await contributionTotalsOf(tx, ids);
  for (const id of ids) {
    const d = (after.get(id) ?? 0) - (before.get(id) ?? 0);
    if (d !== 0) await tx.lifePlan.updateMany({ where: { id }, data: { currentAmount: { increment: d } } });
  }
  return result;
}

/**
 * The deposits that keep a plan's months where they are when one of its lines
 * goes away. Per month: the contribution with the line (`before`) and without
 * it (`after`, same rule); where the line's removal would lower a positive
 * month, the month's deposit becomes `before` — max(before, what's left
 * booked) = before. Expenses later put back on a line of the same plan can't
 * count twice: the month is max(deposit, booked) again. A month the line only
 * took money out of (net withdrawal), or one already at or below zero, is
 * left to the rule. Pure.
 */
export function depositsKeepingLine(
  deposits: { month: string; amount: number }[],
  booked: { month: string; onLine: boolean; kind?: string | null; amount: number }[],
): { month: string; amount: number }[] {
  const deposit = new Map(deposits.map(d => [d.month, d.amount]));
  const total = new Map<string, number>();
  const line = new Map<string, number>();
  for (const b of booked) {
    total.set(b.month, (total.get(b.month) ?? 0) + planContribution(b));
    if (b.onLine) line.set(b.month, (line.get(b.month) ?? 0) + planContribution(b));
  }
  const out: { month: string; amount: number }[] = [];
  for (const [month, onLine] of line) {
    const d = deposit.get(month) ?? null;
    const before = monthContribution(d, total.get(month)!);
    const after = monthContribution(d, total.get(month)! - onLine);
    if (after < before && before > 0) out.push({ month, amount: before });
  }
  return out;
}

/**
 * Before deleting plan line `lineId` (inside the caller's transaction, with
 * the plan locked by withPlanTotals): writes the deposits depositsKeepingLine
 * returns, so what the line contributed stays in the plan. The deposits carry
 * no author (byUserId null): nobody typed them.
 */
export async function keepLineContributions(tx: Tx, poolUserId: string, planId: string, lineId: string): Promise<void> {
  const [settings, deposits, expenses] = await Promise.all([
    tx.userSettings.findUnique({ where: { userId: poolUserId }, select: { cycleStartDay: true } }),
    tx.planDeposit.findMany({ where: { planId }, select: { month: true, amount: true } }),
    tx.expense.findMany({
      where: { userId: poolUserId, allocation: { type: "plan", lifePlanId: planId } },
      select: { date: true, kind: true, amount: true, allocationId: true },
    }),
  ]);
  const cycleStartDay = clampCycleStartDay(settings?.cycleStartDay ?? 1);
  const keep = depositsKeepingLine(deposits, expenses.map(e => ({
    month: periodKeyFor(e.date, cycleStartDay), onLine: e.allocationId === lineId, kind: e.kind, amount: e.amount,
  })));
  for (const { month, amount } of keep) {
    await tx.planDeposit.upsert({
      where: { planId_month: { planId, month } },
      update: { amount },
      create: { userId: poolUserId, planId, month, amount, byUserId: null },
    });
  }
}
