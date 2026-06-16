// One-off backfill (Epic H3): give existing expenses an attribution.
//
// For each expense missing `payerUserId`: set payer = account owner ?? pool
// userId. If the pool belongs to a household, mark scope='shared' and rebuild
// its ExpenseShare split; otherwise leave it personal. Idempotent — only rows
// without a payer are touched.
//
// Run AFTER `npx prisma db push`:  npx tsx server/scripts/backfillExpenseAttribution.ts
import { prisma } from "../lib/prisma.js";
import { rebuildExpenseShares } from "../lib/expenseShares.js";

(async () => {
  const expenses = await prisma.expense.findMany({
    where: { payerUserId: null },
    select: { id: true, userId: true, amount: true, accountId: true },
  });
  console.log(`Expenses to backfill: ${expenses.length}`);

  // Map a pool userId -> its household id (if any). The pool userId is the
  // primary; households are keyed by an owner membership for that user.
  const householdCache = new Map<string, string | null>();
  async function householdFor(poolUserId: string): Promise<string | null> {
    if (householdCache.has(poolUserId)) return householdCache.get(poolUserId)!;
    const m = await prisma.householdMember.findFirst({
      where: { userId: poolUserId, status: "active" },
      select: { householdId: true },
    });
    const id = m?.householdId ?? null;
    householdCache.set(poolUserId, id);
    return id;
  }

  let shared = 0, personal = 0;
  for (const e of expenses) {
    const account = e.accountId
      ? await prisma.account.findUnique({ where: { id: e.accountId }, select: { ownerUserId: true } })
      : null;
    const payerUserId = account?.ownerUserId ?? e.userId;
    const householdId = await householdFor(e.userId);
    const scope = householdId ? "shared" : "personal";

    await prisma.expense.update({
      where: { id: e.id },
      data: { payerUserId, scope, scopeSource: "manual" },
    });
    if (scope === "shared") {
      await rebuildExpenseShares(e.id, e.amount, householdId, payerUserId);
      shared++;
    } else {
      personal++;
    }
  }

  console.log(`Done. shared=${shared}, personal=${personal}.`);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
