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
}
