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
// The dry run also counts the pool's expenses without createdByUserId and
// plans without ownerUserId: entered while linked before those columns were
// set, unlink can't tell whose they are (server/lib/partnerUnlink.ts).
//
// A couple that fails is reported by error name/code only (e.g. Prisma's
// P2002) — never the message, which can echo values — and the run goes on
// with the next one; the exit code is then 1.
//
// Chains are skipped and reported, never repaired: a member who also has
// someone linked to her, or an inviter who is itself linked to someone else,
// has no single well-defined pool (server/lib/partnerRepair.ts).
//
// The couples are read once at the start, so with --apply each one is merged
// in its own transaction under the same row locks as accept/unlink
// (server/lib/partnerLink.ts), after re-checking that it is still the same
// one-level link. A couple that unlinked, relinked or became a chain since is
// skipped, never re-merged.
//
// Income baseline (UserSettings.monthlyIncome). The household baseline is now
// the owner's + the partner's (server/lib/householdIncome.ts), but the old
// income step wrote the WHOLE pool's income into the owner's row — so for
// those couples the partner is counted twice. Every run reports, per couple,
// booleans only: whether the partner has a baseline, whether the owner's is
// above what her own Income rows say, whether it equals both partners' summed,
// whether a double count is likely, and who would change.
//
// --fix-double-counted-baselines rewrites the baselines of the couples whose
// household baseline likely counts the partner twice (likelyDoubleCount) —
// and only those. Each person (owner and partner) gets the sum of the Income
// rows they own in their most recent CLOSED budget period (the pool's payday)
// with any, transfers in left out; the current period is never used, since
// mid-period it is partial. Someone with no such row keeps their stored
// baseline: it is never set to 0. It writes only together with --apply, under
// the same locks and re-check as the merge; without --apply it reports who
// would change. It never prints amounts, and runs after the data merge of
// that couple.
//
//   npm run repair:partner-data                                       # dry run
//   npm run repair:partner-data -- --apply                            # move the data
//   npm run repair:partner-data -- --fix-double-counted-baselines     # dry run incl. baselines
//   npm run repair:partner-data -- --apply --fix-double-counted-baselines
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ensureHousehold } from "../lib/household.js";
import { isEmptySummary, mergeMemberIntoPool, previewPoolMerge, type MergeSummary } from "../lib/partnerMerge.js";
import { lockSettings, coupleChange } from "../lib/partnerLink.js";
import { planRepairCouples, baselineFromOwnIncomes, assessCoupleBaseline, type CoupleBaselineCheck } from "../lib/partnerRepair.js";
import { clampCycleStartDay, currentPeriodKey, periodKeyFor } from "../lib/period.js";
import { pathToFileURL } from "node:url";

function line(s: MergeSummary): string {
  return Object.entries(s).filter(([, n]) => n !== 0).map(([k, n]) => `${k}=${n}`).join(" ");
}

/** An error's name and code (e.g. a Prisma P2002), never its message. */
function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}

function flags(c: CoupleBaselineCheck): string {
  return Object.entries(c).map(([k, v]) => `${k}=${v}`).join(" ");
}

/** Re-reads the couple's link (call with lockSettings held): what changed since
 *  the script read it, or null when it is still the same one-level link. */
async function linkChanged(tx: Prisma.TransactionClient, memberId: string, poolId: string) {
  const [member, linkedToMember, pool] = await Promise.all([
    tx.userSettings.findUnique({ where: { userId: memberId }, select: { linkedUserId: true } }),
    tx.userSettings.findFirst({ where: { linkedUserId: memberId }, select: { id: true } }),
    tx.userSettings.findUnique({ where: { userId: poolId }, select: { linkedUserId: true } }),
  ]);
  return coupleChange(poolId, {
    memberLinkedTo: member?.linkedUserId ?? null,
    someoneLinkedToMember: !!linkedToMember,
    poolLinkedTo: pool?.linkedUserId ?? null,
  });
}

/** Baseline from the Income rows `personId` owns, in the pool or (not yet merged) under her own userId. */
async function ownIncomeBaseline(personId: string, poolId: string, cycleStartDay: number): Promise<number | null> {
  const rows = await prisma.income.findMany({
    where: { ownerUserId: personId, userId: { in: [poolId, personId] } },
    select: { amount: true, date: true, category: true },
  });
  return baselineFromOwnIncomes(rows, d => periodKeyFor(d, cycleStartDay), currentPeriodKey(cycleStartDay));
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

export interface RepairOptions {
  apply: boolean;
  setBaselines: boolean; // --fix-double-counted-baselines
}

export interface RepairResult {
  pending: number;      // couples with data to move (moved, with apply)
  skipped: number;
  doubleCounts: number;
  baselinesSet: number;
  failed: number;       // couples that threw (reported by error name/code)
}

/** The whole repair (see the header). Exported so the integration test
 *  (server/lib/partnerFlow.integration.test.ts) can run it in-process. */
export async function repairPartnerData({ apply, setBaselines }: RepairOptions): Promise<RepairResult> {
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
  let failed = 0;
  const couples = planRepairCouples(linked.map(l => ({ userId: l.userId, linkedUserId: l.linkedUserId! })));
  for (const [i, { memberId, poolId, skip }] of couples.entries()) {
    const label = `couple #${i + 1}`;
    try {
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
          // The couples were read once, at the start. Under the same locks as
          // accept/unlink, make sure this is still the same one-level link
          // before merging: one that unlinked meanwhile must not be re-merged.
          const result = await prisma.$transaction(async (tx) => {
            await lockSettings(tx, [memberId, poolId]);
            const changed = await linkChanged(tx, memberId, poolId);
            if (changed) return { changed };
            const householdId = await ensureHousehold(poolId, memberId, "transparent", tx);
            return { moved: await mergeMemberIntoPool(tx, { memberId, poolId, householdId }) };
          }, { timeout: 60_000 });
          if ("changed" in result) {
            console.warn(`${label}: skipped (link changed since the start: ${result.changed})`);
            skipped++;
            continue;
          }
          console.log(`${label}: moved ${line(result.moved)}`);
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
        const written = writes.length === 0 ? 0 : await prisma.$transaction(async (tx) => {
          await lockSettings(tx, [memberId, poolId]);
          if (await linkChanged(tx, memberId, poolId)) return 0;
          for (const w of writes) {
            await tx.userSettings.update({ where: { userId: w.userId }, data: { monthlyIncome: w.monthlyIncome } });
          }
          return writes.length;
        });
        baselinesSet += written;
        console.log(`${label}: double-counted baselines recomputed from own incomes: ${written}`);
      }

      if (!apply) {
        const [unattributedExpenses, unownedPlans] = await Promise.all([
          prisma.expense.count({ where: { userId: poolId, createdByUserId: null } }),
          prisma.lifePlan.count({ where: { userId: poolId, ownerUserId: null } }),
        ]);
        console.log(`${label}: entered while linked before this version: won't come back on unlink — `
          + `pool expenses without createdByUserId=${unattributedExpenses} (unless on her accounts or debts), `
          + `pool plans without ownerUserId=${unownedPlans}`);
      }
    } catch (e) {
      failed++;
      console.error(`${label}: failed (${errorTag(e)})`);
    }
  }

  console.log(apply
    ? `Done. Couples repaired: ${pending}, skipped: ${skipped}.`
    : `Dry run. Couples with data to move: ${pending}, skipped: ${skipped}. Re-run with --apply to move it.`);
  console.log(`Couples whose baseline likely counts the partner twice: ${doubleCounts}.${
    setBaselines && apply ? ` Baselines recomputed: ${baselinesSet}.`
      : " Re-run with --apply --fix-double-counted-baselines to recompute them from each person's own incomes."}`);
  if (failed > 0) console.error(`Couples that failed: ${failed}.`);
  return { pending, skipped, doubleCounts, baselinesSet, failed };
}

// Run as a script (npm run repair:partner-data), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  repairPartnerData({
    apply: process.argv.includes("--apply"),
    setBaselines: process.argv.includes("--fix-double-counted-baselines"),
  })
    .then(async ({ failed }) => {
      await prisma.$disconnect();
      if (failed > 0) process.exitCode = 1;
    })
    .catch(async (e) => {
      console.error(`Repair failed (${errorTag(e)})`);
      await prisma.$disconnect();
      process.exit(1);
    });
}
