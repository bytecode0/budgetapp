// Backfill for rows from before per-person attribution (LPBETA-04): expenses
// without createdByUserId and life plans without ownerUserId. Without an
// author, unlinking a couple can't tell whose they are
// (server/lib/partnerUnlink.ts) and the active-users count credits them to the
// pool's owner.
//
// Only what is certain is filled in, with the pool's owner (userId):
//   - a pool that never had a partner: every such row is the owner's;
//   - a pool that has or had one: only rows created before the earliest sign
//     of a partner. Rows from after are left as they are and counted as
//     "ambiguous": either of the two may have entered them.
// Signs of a partner, past or present (unlinking clears linkedUserId and the
// membership, so the current state alone is not enough):
//   - a UserSettings.linkedUserId pointing at the pool (its HouseholdMember
//     .joinedAt; no membership row = no safe cutoff at all);
//   - an accepted PartnerInvite sent by the pool's owner (its createdAt, which
//     is before the acceptance);
//   - a pool expense paid by, or shared with, someone else (its createdAt).
//
// Dry run by default. Prints counts only — no names, emails, amounts or ids.
// Idempotent: filled rows are no longer null, so a re-run finds nothing.
//
//   npm run backfill:legacy-owners             # dry run
//   npm run backfill:legacy-owners -- --apply  # write
//
// Against production, in your own terminal: DATABASE_URL='' npm run backfill:legacy-owners
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export interface PoolPlan {
  poolId: string;
  // Rows created before this belong to the owner; null = all of them.
  cutoff: Date | null;
}

// The earliest sign of a partner is the safe cutoff. A null sign is one with
// no known date: then nothing is certain, and nothing is filled.
export function cutoffFor(partnerSigns: (Date | null)[]): { hasPartner: boolean; cutoff: Date | null } {
  if (partnerSigns.length === 0) return { hasPartner: false, cutoff: null };
  const known = partnerSigns.filter((d): d is Date => d !== null);
  if (known.length < partnerSigns.length) return { hasPartner: true, cutoff: new Date(0) };
  return { hasPartner: true, cutoff: new Date(Math.min(...known.map(d => d.getTime()))) };
}

export interface BackfillResult {
  pools: number;
  expenses: { fill: number; ambiguous: number };
  plans: { fill: number; ambiguous: number };
}

export async function backfillLegacyOwners(prisma: PrismaClient, apply: boolean): Promise<BackfillResult> {
  const [expensePools, planPools] = await Promise.all([
    prisma.expense.groupBy({ by: ["userId"], where: { createdByUserId: null } }),
    prisma.lifePlan.groupBy({ by: ["userId"], where: { ownerUserId: null } }),
  ]);
  const poolIds = [...new Set([...expensePools, ...planPools].map(p => p.userId))];
  const result: BackfillResult = { pools: poolIds.length, expenses: { fill: 0, ambiguous: 0 }, plans: { fill: 0, ambiguous: 0 } };

  for (const poolId of poolIds) {
    const partners = await prisma.userSettings.findMany({ where: { linkedUserId: poolId }, select: { userId: true } });
    const joins = await Promise.all(partners.map(async p => {
      const m = await prisma.householdMember.findFirst({
        where: { userId: p.userId, household: { members: { some: { userId: poolId } } } },
        orderBy: { joinedAt: "asc" },
        select: { joinedAt: true },
      });
      return m?.joinedAt ?? null;
    }));
    const [invite, otherPayer, otherShare] = await Promise.all([
      prisma.partnerInvite.findFirst({ where: { senderId: poolId, status: "accepted" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.expense.findFirst({
        where: { userId: poolId, payerUserId: { not: null }, NOT: { payerUserId: poolId } },
        orderBy: { createdAt: "asc" }, select: { createdAt: true },
      }),
      prisma.expense.findFirst({
        where: { userId: poolId, shares: { some: { userId: { not: poolId } } } },
        orderBy: { createdAt: "asc" }, select: { createdAt: true },
      }),
    ]);
    const signs: (Date | null)[] = [...joins];
    for (const found of [invite, otherPayer, otherShare]) if (found) signs.push(found.createdAt);
    const { cutoff } = cutoffFor(signs);
    const before = cutoff ? { createdAt: { lt: cutoff } } : {};

    const expenseWhere = { userId: poolId, createdByUserId: null, ...before };
    const planWhere = { userId: poolId, ownerUserId: null, ...before };
    const [expFill, expAll, planFill, planAll] = await Promise.all([
      prisma.expense.count({ where: expenseWhere }),
      prisma.expense.count({ where: { userId: poolId, createdByUserId: null } }),
      prisma.lifePlan.count({ where: planWhere }),
      prisma.lifePlan.count({ where: { userId: poolId, ownerUserId: null } }),
    ]);
    result.expenses.fill += expFill;
    result.expenses.ambiguous += expAll - expFill;
    result.plans.fill += planFill;
    result.plans.ambiguous += planAll - planFill;

    if (apply && (expFill > 0 || planFill > 0)) {
      await prisma.$transaction([
        prisma.expense.updateMany({ where: expenseWhere, data: { createdByUserId: poolId } }),
        prisma.lifePlan.updateMany({ where: planWhere, data: { ownerUserId: poolId } }),
      ]);
    }
  }
  return result;
}

// Error name and Prisma code only: a message can echo values.
function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}

// Run as a script, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Logging off: Prisma would print full error messages.
  const prisma = new PrismaClient({ log: [] });
  const apply = process.argv.includes("--apply");
  backfillLegacyOwners(prisma, apply)
    .then(async (r) => {
      console.log(`Pools with rows without an author: ${r.pools}`);
      console.log(`Expenses: ${r.expenses.fill} ${apply ? "filled" : "to fill"} with the pool owner · ${r.expenses.ambiguous} left as they are (entered while a partner was linked)`);
      console.log(`Plans:    ${r.plans.fill} ${apply ? "filled" : "to fill"} with the pool owner · ${r.plans.ambiguous} left as they are`);
      if (!apply) console.log("Dry run. Re-run with --apply to write.");
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(`Backfill failed (${errorTag(e)})`);
      await prisma.$disconnect();
      process.exit(1);
    });
}
