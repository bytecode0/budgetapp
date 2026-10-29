// Household helpers (Epic H1). Shared by the partner accept flow, the API
// router, and the backfill/seed scripts so household creation stays consistent.
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const MODELS = new Set(["individual", "proportional", "shared"]);
const TIERS = new Set(["transparent", "shared_stats", "global_only"]);

export function isFinancialModel(v: unknown): v is string {
  return typeof v === "string" && MODELS.has(v);
}
export function isVisibilityTier(v: unknown): v is string {
  return typeof v === "string" && TIERS.has(v);
}

/**
 * Idempotently ensure a household with `primaryId` as owner, optionally adding
 * `secondaryId` as a member. Returns the household id. `visibilityTier` defaults
 * to "transparent" when a partner is linked (preserves the legacy pool's full
 * visibility); standalone households created via the API use "shared_stats".
 * Pass a transaction client as `db` to run it inside a transaction.
 */
export async function ensureHousehold(
  primaryId: string,
  secondaryId?: string,
  visibilityTier = "transparent",
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  let owner = await db.householdMember.findFirst({
    where: { userId: primaryId, role: "owner" },
    select: { householdId: true },
  });

  let householdId: string;
  if (owner) {
    householdId = owner.householdId;
  } else {
    const primary = await db.user.findUnique({ where: { id: primaryId }, select: { name: true } });
    const household = await db.household.create({
      data: {
        name: primary?.name ? `Hogar de ${primary.name}` : "Mi hogar",
        financialModel: "shared",
        visibilityTier,
      },
    });
    householdId = household.id;
    await db.householdMember.create({
      data: { householdId, userId: primaryId, role: "owner", status: "active" },
    });
  }

  if (secondaryId) {
    const exists = await db.householdMember.findFirst({
      where: { householdId, userId: secondaryId }, select: { id: true },
    });
    if (!exists) {
      await db.householdMember.create({
        data: { householdId, userId: secondaryId, role: "member", status: "active" },
      });
    }
  }

  return householdId;
}
