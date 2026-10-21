// Test helper: wipe one user's income, debts and budget so the onboarding
// wizard's "needs onboarding" check (server/routes/onboarding.ts) flips back
// to true and BudgetOnboarding shows again on next login — without creating a
// second account. needsOnboarding is derived live from this data, never a
// stored flag, so clearing it is all that's needed.
//
// Only manual accounts this user owns are ever deleted: a partner's shared
// accounts and anything linked to a bank connection are always kept.
// Card accounts always go with their debts (a card account is the debt's
// other half — server/lib/cardDebt.ts). Other accounts and Household /
// PartnerInvite rows are left alone by default — pass --accounts to also
// clear the savings and bank-account steps' accounts (the default checking
// account is re-created on the next load) for a fully clean slate.
//
// Run:  npx tsx server/scripts/resetOnboardingForTesting.ts you@email.com [--accounts]
import { prisma } from "../lib/prisma.js";

(async () => {
  const email = process.argv[2];
  const resetAccounts = process.argv.includes("--accounts");
  if (!email) {
    console.error("Usage: npx tsx server/scripts/resetOnboardingForTesting.ts <email> [--accounts]");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) { console.error(`No user with email ${email}`); process.exit(1); }
  const userId = user.id;

  const [incomes, debts, allocations] = await Promise.all([
    prisma.income.deleteMany({ where: { userId } }),
    prisma.debt.deleteMany({ where: { userId } }),
    prisma.allocation.deleteMany({ where: { userId } }),
  ]);
  const ownManual = { userId, ownerUserId: userId, bankConnectionId: null };
  const cards = await prisma.account.deleteMany({ where: { ...ownManual, type: "card" } });
  await prisma.userSettings.update({ where: { userId }, data: { monthlyIncome: 0 } }).catch(() => {});

  console.log(`Deleted ${incomes.count} income row(s), ${debts.count} debt(s), ${cards.count} card account(s), ${allocations.count} allocation(s).`);
  console.log("monthlyIncome reset to 0.");

  if (resetAccounts) {
    const accounts = await prisma.account.deleteMany({ where: { ...ownManual, type: { in: ["cash", "savings", "investment", "checking"] } } });
    console.log(`Deleted ${accounts.count} cash/savings/investment/checking account(s).`);
  } else {
    console.log("Accounts left untouched — pass --accounts to also clear the savings and bank-account steps' data.");
  }

  console.log(`\nDone. Log back in as ${email} (or just reload the app while logged in) — onboarding should show again.`);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
