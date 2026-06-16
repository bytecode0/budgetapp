// Persisting expense shares (Epic H3). Bridges the pure split engine
// (contributions.ts) to the DB: resolves the household's members + per-member
// income (for the proportional model) and writes ExpenseShare rows.
import { prisma } from "./prisma.js";
import { computeShares, type SplitBasis } from "./contributions.js";

// Relative income per member over the last 6 months (magnitude is what matters
// for proportional weighting, not the exact figure).
async function incomeByMember(memberIds: string[]): Promise<Record<string, number>> {
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const grouped = await prisma.income.groupBy({
    by: ["ownerUserId"],
    where: { ownerUserId: { in: memberIds }, date: { gte: since } },
    _sum: { amount: true },
  });
  const out: Record<string, number> = {};
  for (const g of grouped) out[g.ownerUserId] = g._sum.amount ?? 0;
  return out;
}

/** Basis implied by a household's financial model. */
function basisForModel(model: string): SplitBasis {
  return model === "proportional" ? "income" : "equal";
}

/**
 * Replace an expense's shares with a freshly computed split for the household.
 * No-op (and clears any shares) when there's no household. Returns the share map.
 */
export async function rebuildExpenseShares(
  expenseId: string,
  amountCents: number,
  householdId: string | null | undefined,
  payerUserId: string,
): Promise<Map<string, number>> {
  await prisma.expenseShare.deleteMany({ where: { expenseId } });
  if (!householdId) return new Map();

  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { financialModel: true, members: { where: { status: "active" }, select: { userId: true } } },
  });
  if (!household || household.members.length === 0) return new Map();

  const memberIds = household.members.map(m => m.userId);
  const basis = basisForModel(household.financialModel);
  const incomeByUser = basis === "income" ? await incomeByMember(memberIds) : {};

  const shares = computeShares({ amountCents, basis, memberIds, payerUserId, incomeByUser });
  await prisma.expenseShare.createMany({
    data: [...shares.entries()].map(([userId, amount]) => ({ expenseId, userId, amount })),
  });
  return shares;
}
