// The household's planned income baseline: what the budget, the onboarding
// result and the debt timeline use when a month has no recorded Income rows.
//
// Each person keeps their OWN baseline in their own UserSettings.monthlyIncome
// (PATCH /api/allocations/settings/income writes the signed-in user's row), and
// the pool's baseline is the sum over the pool owner and every partner linked
// to it. So a partner's income counts as soon as she accepts, nobody can
// overwrite the other's figure, and unlinking leaves each with their own.
import { prisma } from "./prisma.js";

/** Sum of per-person baselines, in cents. */
export function sumBaselines(monthlyIncomes: number[]): number {
  return monthlyIncomes.reduce((s, n) => s + n, 0);
}

/** Planned monthly income of the pool `poolUserId` (= req.userId), in cents. */
export async function householdBaselineIncome(poolUserId: string): Promise<number> {
  const rows = await prisma.userSettings.findMany({
    where: { OR: [{ userId: poolUserId }, { linkedUserId: poolUserId }] },
    select: { monthlyIncome: true },
  });
  return sumBaselines(rows.map(r => r.monthlyIncome));
}
