// Demo data for testing Phase F (recurring detection + duplicate merge).
// Seeds the target user with:
//   - a "Netflix" subscription (12.99) across the last 4 months  -> recurring
//   - two "Amazon" charges (49.90) one day apart                 -> duplicates
// Idempotent-ish: skips rows that already look seeded so re-runs don't pile up.
//
// Usage:  npx tsx server/scripts/seedPhaseF.ts
import { prisma } from "../lib/prisma.js";
import { normalizeMerchant } from "../lib/normalizeMerchant.js";
import { toCents } from "../lib/money.js";
import { createDefaultAccount } from "../lib/defaults.js";

const EMAIL = "luis.vespa@digidentity.com";

function monthRange(d: Date) {
  return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 1)] as const;
}

async function main() {
  const user = await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } });
  if (!user) { console.error(`[seed] no user with email ${EMAIL}`); process.exit(1); }
  const userId = user.id;

  await createDefaultAccount(userId);
  const account = await prisma.account.findFirst({ where: { userId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const fixed = await prisma.allocation.findFirst({ where: { userId, type: "fixed" }, select: { id: true } });

  const now = new Date();

  // ── Recurring: Netflix 12.99 on day 5 of the last 4 months ──
  const subMerchant = normalizeMerchant("Netflix");
  let subCreated = 0;
  for (let i = 3; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 5);
    const [gte, lt] = monthRange(date);
    const exists = await prisma.expense.findFirst({ where: { userId, merchant: subMerchant, date: { gte, lt } } });
    if (exists) continue;
    await prisma.expense.create({
      data: {
        userId, accountId: account?.id ?? null, allocationId: fixed?.id ?? null,
        amount: toCents(12.99), description: "Netflix", merchant: subMerchant,
        source: "manual", date,
      },
    });
    subCreated++;
  }

  // ── Duplicates: two Amazon 49.90 charges, today and yesterday ──
  const dupMerchant = normalizeMerchant("Amazon");
  const dupExisting = await prisma.expense.count({ where: { userId, merchant: dupMerchant, amount: toCents(49.9) } });
  let dupCreated = 0;
  if (dupExisting < 2) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
    for (const date of [today, yesterday]) {
      await prisma.expense.create({
        data: {
          userId, accountId: account?.id ?? null, allocationId: null,
          amount: toCents(49.9), description: "Amazon", merchant: dupMerchant,
          source: "manual", date,
        },
      });
      dupCreated++;
    }
  }

  console.log(`[seed] subscription rows added: ${subCreated} (Netflix 12.99, last 4 months)`);
  console.log(`[seed] duplicate rows added: ${dupCreated} (Amazon 49.90, today + yesterday)`);
  console.log(`[seed] done for ${EMAIL}.`);
}

main()
  .catch((err) => { console.error("[seed] failed:", err); process.exit(1); })
  .finally(() => prisma.$disconnect());
