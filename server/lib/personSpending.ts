// Per-person spending for the household dashboard (Epic H3). Pure.
//
// What each member consumed: a shared expense by its shares (scaled to what it
// counts: a card payment only for its pre-existing-debt part), a personal one
// by its beneficiary, else its payer. A refund counts negative (counted =
// −amount) for whoever it's attributed to, so the per-person amounts add up to
// the household total when every movement has a member.
export interface PersonExpense {
  id: string;
  amount: number; // cents, as stored (positive)
  scope: string;
  payerUserId: string | null;
  beneficiaryUserId: string | null;
  shares: { userId: string; amount: number }[];
}

export function spentByPerson(
  expenses: PersonExpense[],
  memberIds: string[],
  counted: ReadonlyMap<string, number>,
): Record<string, number> {
  const spent = (e: PersonExpense) => counted.get(e.id) ?? e.amount;
  const out: Record<string, number> = Object.fromEntries(memberIds.map(id => [id, 0]));
  for (const e of expenses) {
    if (e.scope === "shared" && e.shares.length > 0) {
      const ratio = e.amount > 0 ? spent(e) / e.amount : 1;
      for (const s of e.shares) if (s.userId in out) out[s.userId] += Math.round(s.amount * ratio);
    } else {
      const who = e.beneficiaryUserId ?? e.payerUserId;
      if (who && who in out) out[who] += spent(e);
    }
  }
  return out;
}
