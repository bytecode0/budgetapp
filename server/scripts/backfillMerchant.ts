// One-off data migration for Fase A.
// Populates Expense.merchant for rows created before the column existed and
// ensures source defaults to "manual". Safe to re-run (idempotent).
//
// Usage:  npx tsx server/scripts/backfillMerchant.ts
import { prisma } from "../lib/prisma.js";
import { normalizeMerchant } from "../lib/normalizeMerchant.js";

async function main() {
  // Rows whose merchant is still empty but that have a description to derive from,
  // plus any row left without a source.
  const expenses = await prisma.expense.findMany({
    where: { OR: [{ merchant: "" }, { source: "" }] },
    select: { id: true, description: true, merchant: true, source: true },
  });

  console.log(`[backfill] scanning ${expenses.length} expense(s)…`);

  let updated = 0;
  for (const e of expenses) {
    const merchant = e.merchant || normalizeMerchant(e.description);
    const source = e.source || "manual";
    if (merchant === e.merchant && source === e.source) continue;
    await prisma.expense.update({
      where: { id: e.id },
      data: { merchant, source },
    });
    updated++;
  }

  console.log(`[backfill] done — ${updated} row(s) updated.`);
}

main()
  .catch((err) => {
    console.error("[backfill] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
