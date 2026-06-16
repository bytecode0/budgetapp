// Test helper (Epic H1): create a household for a user by email so you can
// verify the model end-to-end without the full partner invite flow.
// Adds the user as owner; if they have a legacy linked partner (linkedUserId in
// either direction), adds that partner as a member too. Idempotent.
//
// Run:  npx tsx server/scripts/seedHousehold.ts you@email.com
import { prisma } from "../lib/prisma.js";

(async () => {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npx tsx server/scripts/seedHousehold.ts <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true } });
  if (!user) { console.error(`No user with email ${email}`); process.exit(1); }

  // Reuse an existing owner household if already seeded.
  let membership = await prisma.householdMember.findFirst({
    where: { userId: user.id, role: "owner" },
    select: { householdId: true },
  });

  let householdId: string;
  if (membership) {
    householdId = membership.householdId;
    console.log(`Reusing existing household ${householdId}`);
  } else {
    const h = await prisma.household.create({
      data: {
        name: user.name ? `Hogar de ${user.name}` : "Mi hogar",
        financialModel: "shared",
        visibilityTier: "shared_stats", // new households default to shared_stats (per H5)
      },
    });
    householdId = h.id;
    await prisma.householdMember.create({
      data: { householdId, userId: user.id, role: "owner", status: "active" },
    });
    console.log(`Created household ${householdId} with ${email} as owner`);
  }

  // Pull in a legacy linked partner if one exists (either direction).
  const mySettings = await prisma.userSettings.findUnique({ where: { userId: user.id }, select: { linkedUserId: true } });
  const linkedAsSecondary = await prisma.userSettings.findFirst({ where: { linkedUserId: user.id }, select: { userId: true } });
  const partnerId = mySettings?.linkedUserId ?? linkedAsSecondary?.userId;
  if (partnerId) {
    const exists = await prisma.householdMember.findFirst({ where: { householdId, userId: partnerId }, select: { id: true } });
    if (!exists) {
      await prisma.householdMember.create({ data: { householdId, userId: partnerId, role: "member", status: "active" } });
      console.log(`Added linked partner ${partnerId} as member`);
    }
  }

  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
