// Active users for the BETA (LPBETA-05): prints counts only — never names,
// emails, amounts or ids. Read-only. Against production, Luis runs it in his
// own terminal with the Neon URL between the quotes:
//
//   DATABASE_URL='' npm run stats:active
//
// Definition and sources: server/lib/activeStats.ts.
import { prisma } from "../lib/prisma.js";
import { computeActiveStats, formatActiveStats, loadActivity } from "../lib/activeStats.js";
import { pathToFileURL } from "node:url";

// Error name and Prisma code only: a message can echo values.
function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}

export async function activeStats(now = new Date()): Promise<string> {
  const input = await loadActivity(prisma, now);
  return formatActiveStats(computeActiveStats(input, now), now);
}

// Run as a script (npm run stats:active), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  activeStats()
    .then(async (report) => {
      console.log(report);
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(`Stats failed (${errorTag(e)})`);
      await prisma.$disconnect();
      process.exit(1);
    });
}
