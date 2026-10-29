// The partner link (UserSettings.linkedUserId: member → pool) and the checks
// that keep it one level deep, shared by POST /api/partner/accept, unlink and
// server/scripts/repairPartnerData.ts. Data lives in ONE pool per couple: a
// chain (a pool that is itself linked, a member someone links to) or a pool
// with two members would hide a third person's data or move it into the
// wrong pool.
//
// The checks are pure (unit-tested in partnerLink.test.ts); callers read the
// state with lockSettings() held, so no concurrent accept/unlink can change it
// between the check and the write.
import { Prisma } from "@prisma/client";

/**
 * Locks the given people's UserSettings rows until the transaction ends,
 * always in the same order (so two transactions can't deadlock). Every accept,
 * unlink and repair touching any of them then runs one after the other.
 */
export async function lockSettings(tx: Prisma.TransactionClient, userIds: string[]): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "UserSettings" WHERE "userId" IN (${Prisma.join(userIds)}) ORDER BY "userId" FOR UPDATE`;
}

export interface AcceptState {
  /** Who the accepting user is linked to (null: nobody). */
  meLinkedTo: string | null;
  /** Someone is linked to the accepting user (she is a pool herself). */
  someoneLinkedToMe: boolean;
  /** Who the sender is linked to (null: nobody). */
  senderLinkedTo: string | null;
  /** Someone is already linked to the sender (the pool already has a member). */
  someoneLinkedToSender: boolean;
}

/** Why the invite can't be accepted now, or null. */
export function acceptBlocker(s: AcceptState): string | null {
  if (s.meLinkedTo) return "You are already linked to a partner account";
  if (s.someoneLinkedToMe) return "Someone is already linked to your account";
  if (s.senderLinkedTo) return "The sender is already linked to another account";
  if (s.someoneLinkedToSender) return "The sender already has a linked partner";
  return null;
}

export interface CoupleState {
  /** Who the member is linked to now (null: unlinked meanwhile). */
  memberLinkedTo: string | null;
  /** Someone is linked to the member now. */
  someoneLinkedToMember: boolean;
  /** Who the pool owner is linked to now. */
  poolLinkedTo: string | null;
}

export type CoupleChange = "unlinked" | "relinked" | "member_has_partner_linked" | "pool_is_linked";

/** Whether a couple read earlier is still the same one-level link, or what changed. */
export function coupleChange(poolId: string, s: CoupleState): CoupleChange | null {
  if (s.memberLinkedTo === null) return "unlinked";
  if (s.memberLinkedTo !== poolId) return "relinked";
  if (s.someoneLinkedToMember) return "member_has_partner_linked";
  if (s.poolLinkedTo !== null) return "pool_is_linked";
  return null;
}
