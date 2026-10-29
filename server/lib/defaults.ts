import { prisma } from "./prisma.js";
import { DEFAULT_ACCOUNT_NAME } from "./onboarding.js";
import type { EmailLocale } from "./email/locales/index.js";

const DEFAULT_ALLOCATIONS = [
  { name: "Fixed Expenses",    icon: "🏠", type: "fixed",    sortOrder: 0 },
  { name: "Flexible Spending", icon: "🎯", type: "flexible", sortOrder: 1 },
];

// `language`: the UI language at sign-up, stored only when the settings row is
// created here (an existing row, e.g. from /register, keeps its language).
export async function createDefaultAllocations(userId: string, language?: EmailLocale) {
  const existing = await prisma.allocation.count({ where: { userId } });
  if (existing > 0) return; // already seeded

  await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId, monthlyIncome: 0, ...(language && { language }) },
  });

  await prisma.allocation.createMany({
    data: DEFAULT_ALLOCATIONS.map((a) => ({
      ...a,
      userId,
      allocatedAmount: 0,
      actualAmount: 0,
      isDefault: true,
    })),
  });

  await createDefaultAccount(userId);
}

// Seed a default "Main" account so every user has somewhere to attach expenses.
// Safe to call repeatedly: no-op if the user already has an account.
export async function createDefaultAccount(userId: string) {
  const existing = await prisma.account.count({ where: { userId } });
  if (existing > 0) return;

  await prisma.account.create({
    data: {
      userId,
      ownerUserId: userId,
      name: DEFAULT_ACCOUNT_NAME,
      type: "checking",
      sortOrder: 0,
    },
  });
}
