// Household balances (Epic H4). Derives "who owes whom" from shared expenses:
// for each shared expense the payer fronted the full amount, while each member
// owes their ExpenseShare. balance = paid − owed (positive ⇒ others owe them).
// MVP: computed on the fly (no Settlement records yet — that's V2).
import { prisma } from "./prisma.js";

export interface MemberBalance {
  userId: string;
  paid: number;    // cents fronted on shared expenses
  owed: number;    // cents of shared expenses attributed to them
  balance: number; // paid − owed
}

export interface Settlement {
  fromUserId: string; // debtor
  toUserId: string;   // creditor
  amount: number;     // cents
}

function monthRange(period?: string): { gte: Date; lt: Date } | undefined {
  if (!period) return undefined;
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return undefined;
  return { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) };
}

/** Greedy settlement: match the largest debtor with the largest creditor. */
export function settleUp(balances: MemberBalance[]): Settlement[] {
  const debtors = balances.filter(b => b.balance < 0).map(b => ({ id: b.userId, amt: -b.balance })).sort((a, b) => b.amt - a.amt);
  const creditors = balances.filter(b => b.balance > 0).map(b => ({ id: b.userId, amt: b.balance })).sort((a, b) => b.amt - a.amt);
  const out: Settlement[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    if (pay > 0) out.push({ fromUserId: debtors[i].id, toUserId: creditors[j].id, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i++;
    if (creditors[j].amt === 0) j++;
  }
  return out;
}

/**
 * Compute per-member balances + suggested settlements for a household's shared
 * expenses. `poolUserId` is the scope under which expenses are stored (the
 * primary/pool user id, available as req.userId).
 */
export async function computeBalances(
  poolUserId: string,
  memberIds: string[],
  period?: string,
): Promise<{ balances: MemberBalance[]; settlements: Settlement[] }> {
  const date = monthRange(period);
  const expenses = await prisma.expense.findMany({
    where: { userId: poolUserId, scope: "shared", ...(date ? { date } : {}) },
    select: { amount: true, payerUserId: true, shares: { select: { userId: true, amount: true } } },
  });

  const paid: Record<string, number> = Object.fromEntries(memberIds.map(id => [id, 0]));
  const owed: Record<string, number> = Object.fromEntries(memberIds.map(id => [id, 0]));

  for (const e of expenses) {
    if (e.payerUserId && e.payerUserId in paid) paid[e.payerUserId] += e.amount;
    for (const s of e.shares) {
      if (s.userId in owed) owed[s.userId] += s.amount;
    }
  }

  const balances: MemberBalance[] = memberIds.map(id => ({
    userId: id,
    paid: paid[id],
    owed: owed[id],
    balance: paid[id] - owed[id],
  }));

  return { balances, settlements: settleUp(balances) };
}
