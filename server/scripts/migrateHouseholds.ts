// One-off backfill (Epic H1): turn legacy `linkedUserId` couples into Households.
//
// `UserSettings.linkedUserId` lives on the SECONDARY user and points to the
// PRIMARY. For each primary we create one Household (financialModel='shared',
// visibilityTier='transparent' to preserve current behaviour), add the primary
// as owner and each linked secondary as member. Idempotent: safe to re-run —
// existing memberships are left untouched. `linkedUserId` is NOT removed; it
// stays in parallel until all reads migrate to the household scope.
//
// Run with:  npx tsx server/scripts/migrateHouseholds.ts
import { prisma } from "../lib/prisma.js";

(async () => {
  const linked = await prisma.userSettings.findMany({
    where: { linkedUserId: { not: null } },
    select: { userId: true, linkedUserId: true },
  });

  // primaryId -> set of secondary userIds
  const byPrimary = new Map<string, Set<string>>();
  for (const s of linked) {
    const primaryId = s.linkedUserId!;
    const set = byPrimary.get(primaryId) ?? new Set<string>();
    set.add(s.userId);
    byPrimary.set(primaryId, set);
  }

  let households = 0;
  let membersAdded = 0;

  for (const [primaryId, secondaries] of byPrimary) {
    const primary = await prisma.user.findUnique({ where: { id: primaryId }, select: { id: true, name: true } });
    if (!primary) {
      console.warn(`[skip] primary ${primaryId} not found`);
      continue;
    }

    // Reuse the primary's existing household (as owner) if already migrated.
    let membership = await prisma.householdMember.findFirst({
      where: { userId: primaryId, role: "owner" },
      select: { householdId: true },
    });

    let householdId: string;
    if (membership) {
      householdId = membership.householdId;
    } else {
      const household = await prisma.household.create({
        data: {
          name: primary.name ? `Hogar de ${primary.name}` : "Mi hogar",
          financialModel: "shared",
          visibilityTier: "transparent",
        },
      });
      householdId = household.id;
      households++;
      await prisma.householdMember.create({
        data: { householdId, userId: primaryId, role: "owner", status: "active" },
      });
      membersAdded++;
    }

    for (const secondaryId of secondaries) {
      const exists = await prisma.householdMember.findFirst({
        where: { householdId, userId: secondaryId },
        select: { id: true },
      });
      if (exists) continue;
      const secondary = await prisma.user.findUnique({ where: { id: secondaryId }, select: { id: true } });
      if (!secondary) {
        console.warn(`[skip] secondary ${secondaryId} not found`);
        continue;
      }
      await prisma.householdMember.create({
        data: { householdId, userId: secondaryId, role: "member", status: "active" },
      });
      membersAdded++;
    }
  }

  console.log(`Done. Households created: ${households}, members added: ${membersAdded}.`);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
