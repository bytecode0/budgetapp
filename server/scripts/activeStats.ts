// Active users for the BETA (LPBETA-05) and the peace question's aggregates
// (LPBETA-24): prints counts only — never names, emails, amounts, ids or
// anyone's answer. Read-only. Against production, Luis runs it in his
// own terminal with the Neon URL between the quotes:
//
//   DATABASE_URL='' npm run stats:active
//
// Definition and sources: server/lib/activeStats.ts.
import { PrismaClient } from "@prisma/client";
import { computeActiveStats, formatActiveStats, loadActivity } from "../lib/activeStats.js";
import { computePeaceStats, formatPeaceStats, loadPeaceRows } from "../lib/peace.js";
import { pathToFileURL } from "node:url";

// Its own client with Prisma's logging off: Prisma would print full error
// messages, which can echo values. Errors are reported by name and code only.
const prisma = new PrismaClient({ log: [] });

function errorTag(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" ? `${e.name} ${code}` : e.name;
}

export async function activeStats(now = new Date()): Promise<string> {
  const [input, peace] = await Promise.all([loadActivity(prisma, now), loadPeaceRows(prisma)]);
  // The peace aggregates (LPBETA-24) only for groups of 5 or more: server/lib/peace.ts.
  return `${formatActiveStats(computeActiveStats(input, now), now)}\n\n${formatPeaceStats(computePeaceStats(peace, now))}`;
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
