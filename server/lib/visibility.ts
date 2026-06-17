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

async function tier(req: AuthRequest): Promise<string> {
  if (!req.householdId) return "transparent";
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

/** Prisma `where` fragment for the EXPENSE list, honoring the visibility tier. */
export async function expenseListingFilter(req: AuthRequest): Promise<Record<string, unknown>> {
  return (await ownOnlyListings(req)) ? { payerUserId: req.authUserId! } : {};
}

/** Prisma `where` fragment for the INCOME list, honoring the visibility tier. */
export async function incomeListingFilter(req: AuthRequest): Promise<Record<string, unknown>> {
  return (await ownOnlyListings(req)) ? { ownerUserId: req.authUserId! } : {};
}
