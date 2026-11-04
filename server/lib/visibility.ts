// Visibility enforcement (Epic H5).
//
// The household's visibilityTier controls what a member can see of the OTHER
// members' data. Enforced server-side — never filter in the client.
//
//   transparent   → see everything (no filter)
//   shared_stats  → see aggregates (totals, savings, goals) but NOT the other
//                   members' individual transactions. Listing endpoints are
//                   therefore restricted to the viewer's OWN transactions.
//   global_only   → (V2) same listing restriction as shared_stats for now.
//
// Aggregation endpoints (analytics, monthly review, dashboard) intentionally do
// NOT apply this filter — combined totals are shared at shared_stats.
import { prisma } from "./prisma.js";
import { AuthRequest } from "../middleware/auth.js";
import { visibleExpenseWhere, visibleIncomeWhere } from "./poolRefs.js";

async function tier(req: AuthRequest): Promise<string> {
  // Linked to a pool (req.userId is someone else's) but in no household: a
  // leftover link must not open the pool's listings, so the most restrictive
  // tier applies. Alone in her own scope, there is nobody else to hide.
  if (!req.householdId) return req.userId !== req.authUserId ? "global_only" : "transparent";
  const hh = await prisma.household.findUnique({
    where: { id: req.householdId },
    select: { visibilityTier: true },
  });
  return hh?.visibilityTier ?? "transparent";
}

/** Whether the viewer is restricted to their own transactions in list views. */
export async function ownOnlyListings(req: AuthRequest): Promise<boolean> {
  return (await tier(req)) !== "transparent";
}

/** Prisma `where` fragment for the EXPENSE list (and the rows a caller may
 *  change by id), honoring the visibility tier. In every tier it leaves out
 *  the other member's rows on a private debt or account (poolRefs.ts). */
export async function expenseListingFilter(req: AuthRequest): Promise<Record<string, unknown>> {
  const hidden = visibleExpenseWhere(req.authUserId!);
  return (await ownOnlyListings(req)) ? { payerUserId: req.authUserId!, ...hidden } : hidden;
}

/** Prisma `where` fragment for the INCOME list, honoring the visibility tier;
 *  in every tier without the other member's income on a private account. */
export async function incomeListingFilter(req: AuthRequest): Promise<Record<string, unknown>> {
  const hidden = visibleIncomeWhere(req.authUserId!);
  return (await ownOnlyListings(req)) ? { ownerUserId: req.authUserId!, ...hidden } : hidden;
}
