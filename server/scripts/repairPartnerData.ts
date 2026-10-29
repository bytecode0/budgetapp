// Repair for couples linked before POST /api/partner/accept moved the invited
// partner's data: anything she created under her own userId (usually her
// onboarding, done before accepting) is hidden, because once linked her data
// scope is the inviter's pool. This moves it into the pool with the same
// function the accept route uses (server/lib/partnerMerge.ts), keeping her as
// owner.
//
// Dry run by default: prints, per linked couple, how many rows would move —
// counts only, no names, emails, amounts or ids. Idempotent: once moved,
// nothing is left under her userId, so a re-run reports nothing to do.
//
// Chains are skipped and reported, never repaired: a member who also has
// someone linked to her, or an inviter who is itself linked to someone else,
// has no single well-defined pool (server/lib/partnerRepair.ts).
//
// Income baseline (UserSettings.monthlyIncome). The household baseline is now
// the owner's + the partner's (server/lib/householdIncome.ts), but the old
// income step wrote the WHOLE pool's income into the owner's row — so for
// those couples the partner is counted twice. Every run reports, per couple,
// booleans only: whether the partner has a baseline, whether the owner's is
// above what her own Income rows say, whether it equals both partners' summed,
// whether a double count is likely, and who would change.
//
// --set-owner-baseline-from-own-incomes recomputes EACH person's baseline
// (owner and partner) from the Income rows that person owns: the sum of their
// most recent budget period (the pool's payday) with any, transfers in left
// out. Someone with no such row keeps their stored baseline (never zeroed).
// It writes only together with --apply; without it, it reports what would change.
// It never prints amounts, and runs after the data merge of that couple.
//
//   npm run repair:partner-data                                              # dry run
//   npm run repair:partner-data -- --apply                                   # move the data
//   npm run repair:partner-data -- --set-owner-baseline-from-own-incomes     # dry run incl. baselines
//   npm run repair:partner-data -- --apply --set-owner-baseline-from-own-incomes
import { prisma } from "../lib/prisma.js";
import { ensureHousehold } from "../lib/household.js";
import { isEmptySummary, mergeMemberIntoPool, previewPoolMerge, type MergeSummary } from "../lib/partnerMerge.js";
import { planRepairCouples, baselineFromOwnIncomes, assessCoupleBaseline, type CoupleBaselineCheck } from "../lib/partnerRepair.js";
import { clampCycleStartDay, periodKeyFor } from "../lib/period.js";

const apply = process.argv.includes("--apply");
const setBaselines = process.argv.includes("--set-owner-baseline-from-own-incomes");

function line(s: MergeSummary): string {
  return Object.entries(s).filter(([, n]) => n !== 0).map(([k, n]) => `${k}=${n}`).join(" ");
}

function flags(c: CoupleBaselineCheck): string {
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ");
}

/** Baseline from the Income rows `personId` owns, in the pool or (not yet merged) under her own userId. */
async function ownIncomeBaseline(personId: string, poolId: string, cycleStartDay: number): Promise<number | null> {
  const rows = await prisma.income.findMany({
    where: { ownerUserId: personId, userId: { in: [poolId, personId] } },
    select: { amount: true, date: true, category: true },
  });
  return baselineFromOwnIncomes(rows, d => periodKeyFor(d, cycleStartDay));
}

async function checkBaselines(memberId: string, poolId: string) {
  const [owner, partner] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId: poolId }, select: { monthlyIncome: true, cycleStartDay: true } }),
    prisma.userSettings.findUnique({ where: { userId: memberId }, select: { monthlyIncome: true } }),
  ]);
  const cycleStartDay = clampCycleStartDay(owner?.cycleStartDay ?? 1);
  const [ownerFromIncomes, partnerFromIncomes] = await Promise.all([
    ownIncomeBaseline(poolId, poolId, cycleStartDay),
    ownIncomeBaseline(memberId, poolId, cycleStartDay),
  ]);
  const check = assessCoupleBaseline({
    ownerBaseline: owner?.monthlyIncome ?? 0,
    partnerBaseline: partner?.monthlyIncome ?? 0,
    ownerFromIncomes,
    partnerFromIncomes,
  });
  return { check, ownerFromIncomes, partnerFromIncomes };
}

(async () => {
  const linked = await prisma.userSettings.findMany({
    where: { linkedUserId: { not: null } },
    select: { userId: true, linkedUserId: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${apply ? "APPLY" : "DRY RUN"}${setBaselines ? " + baselines" : ""} — linked partners: ${linked.length}`);

  let pending = 0;
  let skipped = 0;
  let doubleCounts = 0;
  let baselinesSet = 0;
  const couples = planRepairCouples(linked.map(l => ({ userId: l.userId, linkedUserId: l.linkedUserId! })));
  for (const [i, { memberId, poolId, skip }] of couples.entries()) {
    const label = `couple #${i + 1}`;

    // Only a one-level link has a well-defined pool.
    const poolUser = await prisma.user.findUnique({ where: { id: poolId }, select: { id: true } });
    if (!poolUser || skip) {
      const why = !poolUser ? "inviter not found"
        : skip === "pool_is_linked" ? "inviter is itself linked"
        : "someone is linked to this partner (chain)";
      console.warn(`${label}: skipped (${why})`);
      skipped++;
      continue;
    }

    const preview = await previewPoolMerge(prisma, memberId, poolId);
    if (isEmptySummary(preview)) {
      console.log(`${label}: nothing to move`);
    } else {
      pending++;
      if (!apply) {
        console.log(`${label}: would move ${line(preview)}`);
      } else {
        const moved = await prisma.$transaction(async (tx) => {
          const householdId = await ensureHousehold(poolId, memberId, "transparent", tx);
          return mergeMemberIntoPool(tx, { memberId, poolId, householdId });
        }, { timeout: 60_000 });
        console.log(`${label}: moved ${line(moved)}`);
      }
    }

    const { check, ownerFromIncomes, partnerFromIncomes } = await checkBaselines(memberId, poolId);
    if (check.likelyDoubleCount) doubleCounts++;
    console.log(`${label}: baseline ${flags(check)}`);
    if (setBaselines && apply) {
      const writes = [
        ...(check.ownerWouldChange ? [{ userId: poolId, monthlyIncome: ownerFromIncomes! }] : []),
        ...(check.partnerWouldChange ? [{ userId: memberId, monthlyIncome: partnerFromIncomes! }] : []),
      ];
      await prisma.$transaction(writes.map(w =>
        prisma.userSettings.update({ where: { userId: w.userId }, data: { monthlyIncome: w.monthlyIncome } })));
      baselinesSet += writes.length;
      console.log(`${label}: baselines recomputed from own incomes: ${writes.length}`);
    }
  }

  console.log(apply
    ? `Done. Couples repaired: ${pending}, skipped: ${skipped}.`
    : `Dry run. Couples with data to move: ${pending}, skipped: ${skipped}. Re-run with --apply to move it.`);
  console.log(`Couples whose baseline likely counts the partner twice: ${doubleCounts}.${
    setBaselines && apply ? ` Baselines recomputed: ${baselinesSet}.`
      : " Re-run with --apply --set-owner-baseline-from-own-incomes to recompute them from each person's own incomes."}`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
