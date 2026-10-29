// Pure decisions behind server/scripts/repairPartnerData.ts (unit-tested in
// partnerRepair.test.ts). The script is only the database around them.

export type CoupleSkip =
  | "member_has_partner_linked" // someone is linked to the member: she is a pool herself
  | "pool_is_linked";           // the inviter is linked to someone else: no single pool

export interface RepairCouple {
  memberId: string;
  poolId: string;
  skip: CoupleSkip | null;
}

/**
 * Pairs every linked partner with her pool. Only one-level links have a
 * well-defined pool: a member who also has someone linked to her, or a pool
 * that is itself linked, is a chain — merging would move a third person's data
 * into the wrong pool, so those are skipped (and reported) instead.
 */
export function planRepairCouples(links: { userId: string; linkedUserId: string }[]): RepairCouple[] {
  const linkedUsers = new Set(links.map(l => l.userId));
  const pools = new Set(links.map(l => l.linkedUserId));
  return links.map(({ userId: memberId, linkedUserId: poolId }) => ({
    memberId,
    poolId,
    skip: pools.has(memberId) ? "member_has_partner_linked"
      : linkedUsers.has(poolId) ? "pool_is_linked"
      : null,
  }));
}

// ── Household baseline repair ──────────────────────────────────────────────
//
// Before per-person baselines (server/lib/householdIncome.ts), the income step
// wrote the WHOLE pool's income into the pool owner's UserSettings.monthlyIncome.
// Now the household baseline is owner + partner, so such an owner row counts
// the partner twice. The fix recomputes each person's baseline from the Income
// rows they own.

export interface OwnedIncome {
  amount: number; // cents
  date: Date;
  category: string;
}

/**
 * A person's baseline from the Income rows they own: the sum of their most
 * recent budget period that has any. Transfers in (`transfer_in`) are left
 * out — moving money between your own accounts, or a partner's transfer, is
 * not earnings and would bring the double count back. Null when they own no
 * such row: their stored baseline is then left alone, never zeroed.
 */
export function baselineFromOwnIncomes(incomes: OwnedIncome[], periodKeyOf: (d: Date) => string): number | null {
  const earned = incomes.filter(i => i.category !== "transfer_in");
  if (earned.length === 0) return null;
  const byPeriod = new Map<string, number>();
  for (const i of earned) {
    const key = periodKeyOf(i.date);
    byPeriod.set(key, (byPeriod.get(key) ?? 0) + i.amount);
  }
  const latest = [...byPeriod.keys()].sort().at(-1)!; // "YYYY-MM" sorts chronologically
  return byPeriod.get(latest)!;
}

export interface CoupleBaselineCheck {
  /** The partner has a baseline of her own, so it is summed with the owner's. */
  partnerHasBaseline: boolean;
  /** Owner's baseline is above what her own Income rows say (null: she has none). */
  ownerAboveOwnIncomes: boolean | null;
  /** Owner's baseline equals both partners' recomputed baselines summed. */
  ownerEqualsCombinedIncomes: boolean;
  /** The household baseline most likely counts the partner twice. */
  likelyDoubleCount: boolean;
  /** Who would get a new baseline with --set-owner-baseline-from-own-incomes. */
  ownerWouldChange: boolean;
  partnerWouldChange: boolean;
}

/** Booleans only: what the repair script reports per couple (no amounts). */
export function assessCoupleBaseline(c: {
  ownerBaseline: number;
  partnerBaseline: number;
  ownerFromIncomes: number | null;
  partnerFromIncomes: number | null;
}): CoupleBaselineCheck {
  const partnerHasBaseline = c.partnerBaseline > 0;
  const ownerAboveOwnIncomes = c.ownerFromIncomes === null ? null : c.ownerBaseline > c.ownerFromIncomes;
  const ownerEqualsCombinedIncomes = c.partnerFromIncomes !== null && c.partnerFromIncomes > 0
    && c.ownerBaseline === (c.ownerFromIncomes ?? 0) + c.partnerFromIncomes;
  return {
    partnerHasBaseline,
    ownerAboveOwnIncomes,
    ownerEqualsCombinedIncomes,
    likelyDoubleCount: partnerHasBaseline && (ownerEqualsCombinedIncomes || ownerAboveOwnIncomes === true),
    ownerWouldChange: c.ownerFromIncomes !== null && c.ownerFromIncomes !== c.ownerBaseline,
    partnerWouldChange: c.partnerFromIncomes !== null && c.partnerFromIncomes !== c.partnerBaseline,
  };
}
