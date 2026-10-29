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
