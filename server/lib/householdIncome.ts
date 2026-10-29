// The household's planned income baseline: what the budget, the onboarding
// result and the debt timeline use when a month has no recorded Income rows.
//
// Each person keeps their OWN baseline in their own UserSettings.monthlyIncome
// (PATCH /api/allocations/settings/income writes the signed-in user's row), and
// the pool's baseline is the sum over the pool owner and every partner linked
// to it. So a partner's income counts as soon as she accepts, nobody can
// overwrite the other's figure, and unlinking leaves each with their own.
//
// Anything that EDITS the baseline must show and send the caller's own figure
// (`ownMonthlyIncome`), never the household sum: writing the sum into one
// person's row would add the partner's income again on every save.
import { prisma } from "./prisma.js";

/** Sum of per-person baselines, in cents. */
export function sumBaselines(monthlyIncomes: number[]): number {
  return monthlyIncomes.reduce((s, n) => s + n, 0);
}

export interface IncomeBaselines {
  monthlyIncome: number;    // cents — the household's (every member's summed)
  ownMonthlyIncome: number; // cents — the signed-in person's own, the editable one
  isCouple: boolean;        // more than one person contributes to the household's
}

/** Splits the pool's per-person baselines into the household total and the
 *  caller's own figure. `rows` are the pool owner's and every linked partner's. */
export function splitBaselines(
  rows: { userId: string; monthlyIncome: number }[],
  authUserId: string,
): IncomeBaselines {
  return {
    monthlyIncome: sumBaselines(rows.map(r => r.monthlyIncome)),
    ownMonthlyIncome: rows.find(r => r.userId === authUserId)?.monthlyIncome ?? 0,
    isCouple: rows.length > 1,
  };
}

async function poolBaselineRows(poolUserId: string) {
  return prisma.userSettings.findMany({
    where: { OR: [{ userId: poolUserId }, { linkedUserId: poolUserId }] },
    select: { userId: true, monthlyIncome: true },
  });
}

/** Planned monthly income of the pool `poolUserId` (= req.userId), in cents. */
export async function householdBaselineIncome(poolUserId: string): Promise<number> {
  return sumBaselines((await poolBaselineRows(poolUserId)).map(r => r.monthlyIncome));
}

/** The household's baseline and the caller's own (req.userId, req.authUserId). */
export async function incomeBaselines(poolUserId: string, authUserId: string): Promise<IncomeBaselines> {
  return splitBaselines(await poolBaselineRows(poolUserId), authUserId);
}
