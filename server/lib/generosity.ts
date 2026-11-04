// The Generosity budget line (LPBETA-10, Método Ruta R1).
//
// - Every budget has exactly one line of type "generosity", first in the
//   list. It can be set to 0 but never deleted nor turned into another type
//   (server/routes/allocations.ts), and no second one can be created.
// - Users from before this ticket get it at 0, lazily: ensureGenerosityLine()
//   runs on GET /api/allocations (which Home and the budget read on every
//   visit) and when the onboarding saves the share. Idempotent, and safe
//   under concurrent requests (a per-pool advisory lock).
// - Its amount can be a share of the HOUSEHOLD's income
//   (UserSettings.generosityBps on the pool's row, basis points). Then the
//   amount is derived, never trusted from the column: the share of
//   householdMonthIncome for the month — the same income Home shows — so if
//   the income changes the line keeps the same %. The stored column is kept
//   in step for the current period (syncGenerosity) for readers that use it raw.
// - Typing an amount for the line on the budget (PATCH /api/allocations…)
//   replaces the share with that fixed amount (generosityBps = null). A
//   month's saved budget (MonthlyBudget) still wins for that month, as with
//   debt lines.
import { prisma } from "./prisma.js";
import { createDefaultAllocations } from "./defaults.js";
import { householdBaselineIncome, householdMonthIncome } from "./householdIncome.js";
import { resolveLocale, type EmailLocale } from "./email/locales/index.js";
import { shareOfIncome } from "../../shared/incomeShare.js";

export const GENEROSITY_TYPE = "generosity";

// Created in the pool's language; never renamed afterwards. "Generosidad",
// never "diezmo": it has to work inside and outside a church.
const GENEROSITY_NAME: Record<EmailLocale, string> = { es: "Generosidad", en: "Generosity" };
export const GENEROSITY_ICON = "🤍";

/** Generosity lines get the share of `incomeCents` when a share is set. Pure. */
export function applyGenerosity<T extends { type: string; allocatedAmount: number }>(
  lines: T[],
  bps: number | null,
  incomeCents: number,
): T[] {
  if (bps === null) return lines;
  const amount = shareOfIncome(incomeCents, bps);
  return lines.map(l => (l.type === GENEROSITY_TYPE ? { ...l, allocatedAmount: amount } : l));
}

/** The sortOrder that puts a new line before every existing one. Pure. */
export function firstSortOrder(sortOrders: number[]): number {
  return sortOrders.length === 0 ? 0 : Math.min(...sortOrders) - 1;
}

/** Creates the pool's Generosity line at 0 when it has none. Idempotent. */
export async function ensureGenerosityLine(poolUserId: string): Promise<void> {
  // Signup seeds the default lines only into an empty budget: seed them first
  // so creating this line never stops that.
  await createDefaultAllocations(poolUserId);
  if (await prisma.allocation.count({ where: { userId: poolUserId, type: GENEROSITY_TYPE } }) > 0) return;
  await prisma.$transaction(async (tx) => {
    // Serialises concurrent first reads of the same pool (released at commit).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"generosity:" + poolUserId}))`;
    if (await tx.allocation.count({ where: { userId: poolUserId, type: GENEROSITY_TYPE } }) > 0) return;
    const [settings, lines] = await Promise.all([
      tx.userSettings.findUnique({ where: { userId: poolUserId }, select: { language: true } }),
      tx.allocation.findMany({ where: { userId: poolUserId }, select: { sortOrder: true } }),
    ]);
    await tx.allocation.create({
      data: {
        userId: poolUserId,
        name: GENEROSITY_NAME[resolveLocale(settings?.language)],
        icon: GENEROSITY_ICON,
        type: GENEROSITY_TYPE,
        allocatedAmount: 0,
        sortOrder: firstSortOrder(lines.map(l => l.sortOrder)),
        isDefault: false,
      },
    });
  });
}

/** The household's income for a period, as Home computes it (cents). */
export async function householdIncomeFor(poolUserId: string, bounds: { start: Date; end: Date }): Promise<number> {
  const [recorded, baseline] = await Promise.all([
    prisma.income.findMany({ where: { userId: poolUserId, date: { gte: bounds.start, lt: bounds.end } }, select: { amount: true } }),
    householdBaselineIncome(poolUserId),
  ]);
  return householdMonthIncome(recorded.map(i => i.amount), baseline).cents;
}

export async function generosityBps(poolUserId: string): Promise<number | null> {
  const s = await prisma.userSettings.findUnique({ where: { userId: poolUserId }, select: { generosityBps: true } });
  return s?.generosityBps ?? null;
}

/** With a share set, writes the line's derived amount for `bounds` into the
 *  stored column (when it differs). Returns the share and the line's amount. */
export async function syncGenerosity(poolUserId: string, bounds: { start: Date; end: Date }): Promise<{ bps: number | null; amount: number }> {
  const bps = await generosityBps(poolUserId);
  if (bps === null) {
    const line = await prisma.allocation.findFirst({ where: { userId: poolUserId, type: GENEROSITY_TYPE }, select: { allocatedAmount: true } });
    return { bps, amount: line?.allocatedAmount ?? 0 };
  }
  const amount = shareOfIncome(await householdIncomeFor(poolUserId, bounds), bps);
  await prisma.allocation.updateMany({
    where: { userId: poolUserId, type: GENEROSITY_TYPE, allocatedAmount: { not: amount } },
    data: { allocatedAmount: amount },
  });
  return { bps, amount };
}

/** A budget edit typed an amount for the Generosity line: it becomes that
 *  fixed amount, no longer a share of the income. */
export async function clearGenerosityShare(poolUserId: string): Promise<void> {
  await prisma.userSettings.updateMany({ where: { userId: poolUserId }, data: { generosityBps: null } });
}

/** What the Generosity line gives in `month` (its period is `bounds`), as the
 *  monthly review counts it: the month's saved budget when there is one, else
 *  the share of the month's income, else the line's fixed amount. Cents. */
export async function generosityForMonth(poolUserId: string, month: string, bounds: { start: Date; end: Date }): Promise<{ bps: number | null; amount: number }> {
  const [line, bps] = await Promise.all([
    prisma.allocation.findFirst({ where: { userId: poolUserId, type: GENEROSITY_TYPE }, select: { id: true, allocatedAmount: true }, orderBy: { sortOrder: "asc" } }),
    generosityBps(poolUserId),
  ]);
  if (!line) return { bps, amount: 0 };
  const saved = await prisma.monthlyBudget.findUnique({ where: { allocationId_month: { allocationId: line.id, month } }, select: { allocatedAmount: true } });
  if (saved) return { bps, amount: saved.allocatedAmount };
  if (bps === null) return { bps, amount: line.allocatedAmount };
  return { bps, amount: shareOfIncome(await householdIncomeFor(poolUserId, bounds), bps) };
}
