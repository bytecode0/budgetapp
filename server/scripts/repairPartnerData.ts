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
//   npm run repair:partner-data            # dry run
//   npm run repair:partner-data -- --apply # move the data
import { prisma } from "../lib/prisma.js";
import { ensureHousehold } from "../lib/household.js";
import { isEmptySummary, mergeMemberIntoPool, previewPoolMerge, type MergeSummary } from "../lib/partnerMerge.js";

const apply = process.argv.includes("--apply");

function line(s: MergeSummary): string {
  return Object.entries(s).filter(([, n]) => n !== 0).map(([k, n]) => `${k}=${n}`).join(" ");
}

(async () => {
  const linked = await prisma.userSettings.findMany({
    where: { linkedUserId: { not: null } },
    select: { userId: true, linkedUserId: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`${apply ? "APPLY" : "DRY RUN"} — linked partners: ${linked.length}`);

  let pending = 0;
  let skipped = 0;
  for (const [i, { userId: memberId, linkedUserId }] of linked.entries()) {
    const poolId = linkedUserId!;
    const label = `couple #${i + 1}`;

    // Only a one-level link has a well-defined pool.
    const pool = await prisma.userSettings.findUnique({ where: { userId: poolId }, select: { linkedUserId: true } });
    const poolUser = await prisma.user.findUnique({ where: { id: poolId }, select: { id: true } });
    if (!poolUser || pool?.linkedUserId) {
      console.warn(`${label}: skipped (${!poolUser ? "inviter not found" : "inviter is itself linked"})`);
      skipped++;
      continue;
    }

    const preview = await previewPoolMerge(prisma, memberId, poolId);
    if (isEmptySummary(preview)) {
      console.log(`${label}: nothing to move`);
      continue;
    }
    pending++;
    if (!apply) {
      console.log(`${label}: would move ${line(preview)}`);
      continue;
    }

    const moved = await prisma.$transaction(async (tx) => {
      const householdId = await ensureHousehold(poolId, memberId, "transparent", tx);
      return mergeMemberIntoPool(tx, { memberId, poolId, householdId });
    }, { timeout: 60_000 });
    console.log(`${label}: moved ${line(moved)}`);
  }

  console.log(apply
    ? `Done. Couples repaired: ${pending}, skipped: ${skipped}.`
    : `Dry run. Couples with data to move: ${pending}, skipped: ${skipped}. Re-run with --apply to move it.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
