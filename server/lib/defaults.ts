import { prisma } from "./prisma.js";

const DEFAULT_ALLOCATIONS = [
  { name: "Fixed Expenses",    icon: "🏠", type: "fixed",    sortOrder: 0 },
  { name: "Flexible Spending", icon: "🎯", type: "flexible", sortOrder: 1 },
];

export async function createDefaultAllocations(userId: string) {
  const existing = await prisma.allocation.count({ where: { userId } });
  if (existing > 0) return; // already seeded

  await prisma.allocation.createMany({
    data: DEFAULT_ALLOCATIONS.map((a) => ({
      ...a,
      userId,
      allocatedAmount: 0,
      actualAmount: 0,
      isDefault: true,
    })),
  });

  await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: { userId, monthlyIncome: 0 },
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
      name: "Main account",
      type: "checking",
      sortOrder: 0,
    },
  });
}
