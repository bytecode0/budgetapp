// One-off data migration for Fase E.
// Ensures every user has a default account and assigns existing expenses
// (created before Account existed) to it. Safe to re-run (idempotent).
//
// Usage:  npx tsx server/scripts/backfillAccounts.ts
import { prisma } from "../lib/prisma.js";
import { createDefaultAccount } from "../lib/defaults.js";

async function main() {
  // Users that still have at least one expense without an account.
  const userIds = (
    await prisma.expense.findMany({
      where: { accountId: null },
      distinct: ["userId"],
      select: { userId: true },
    })
  ).map((e) => e.userId);

  console.log(`[backfill] ${userIds.length} user(s) with unassigned expenses…`);

  let assigned = 0;
  for (const userId of userIds) {
    await createDefaultAccount(userId); // no-op if the user already has one

    // Pick the user's first account (lowest sortOrder) as the default target.
    const target = await prisma.account.findFirst({
      where: { userId },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    if (!target) continue;

    const { count } = await prisma.expense.updateMany({
      where: { userId, accountId: null },
      data: { accountId: target.id },
    });
    assigned += count;
  }

  console.log(`[backfill] done — ${assigned} expense(s) assigned to a default account.`);
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
