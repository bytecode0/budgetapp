// Temporary verification for Epic H1 — prints households and their members (ids only).
// Run AFTER `npx prisma db push` + `npm run migrate:households`:
//   npx tsx server/scripts/checkHouseholds.ts
// Safe to delete afterwards.
import { prisma } from "../lib/prisma.js";

(async () => {
  const households = await prisma.household.findMany({
    include: { members: true }, // ids only: no names or emails in the output
  });
  console.log(`Households: ${households.length}`);
  for (const h of households) {
    console.log(`\n• household ${h.id}  [model=${h.financialModel}, visibility=${h.visibilityTier}]`);
    for (const m of h.members) {
      console.log(`   - ${m.role.padEnd(6)} user ${m.userId}  status=${m.status}`);
    }
  }
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
