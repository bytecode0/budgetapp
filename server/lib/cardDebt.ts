// A credit card is an ACCOUNT (type "card"); its debt is created and kept in
// step behind it, so the user never creates the debt by hand. Purchases "paid
// with" the card raise that debt and payments lower it (server/lib/debtBalance.ts).
import { prisma } from "./prisma.js";
import { getCycleStartDay } from "./getCycleStartDay.js";
import { currentPeriodKey, periodBounds } from "./period.js";
import { ensureDebtLine, setLiveValues, syncDebtAllocations } from "./debtBalance.js";

export const CARD_PAYMENT_MODES = new Set(["full", "minimum"]);

export interface CardSettings {
  paymentMode?: string;           // full | minimum
  owed?: number;                  // cents — what's owed now (live)
  minimumPayment?: number | null; // cents
  paymentDueDay?: number | null;  // 1-28
}

async function currentPeriod(userId: string) {
  const day = await getCycleStartDay(userId);
  return periodBounds(currentPeriodKey(day), day);
}

/** Creates the debt behind a card account (and its budget line). */
export async function createCardDebt(
  ctx: { userId: string; householdId?: string | null },
  account: { id: string; name: string; visibility: string; ownerUserId: string },
  settings: CardSettings,
): Promise<void> {
  const lastOrder = await prisma.debt.findFirst({ where: { userId: ctx.userId }, orderBy: { sortOrder: "desc" } });
  const debt = await prisma.debt.create({
    data: {
      userId: ctx.userId,
      ownerUserId: account.ownerUserId, // the card's owner owns its debt
      householdId: ctx.householdId ?? null,
      visibility: account.visibility,
      name: account.name,
      kind: "credit_card",
      paymentMode: settings.paymentMode ?? "full",
      accountId: account.id,
      currentBalance: settings.owed ?? 0,
      minimumPayment: settings.minimumPayment ?? null,
      paymentDueDay: settings.paymentDueDay ?? null,
      sortOrder: (lastOrder?.sortOrder ?? -1) + 1,
    },
  });
  await ensureDebtLine(ctx.userId, debt, await currentPeriod(ctx.userId));
}

/** The ownership fields a card's debt mirrors from its account. When the
 *  account changes owner or visibility the debt must follow in the same write,
 *  or the old owner keeps editing a debt that is no longer theirs (and the new
 *  owner can't). Returns null when there's nothing to mirror. */
export function cardDebtOwnershipChanges(
  finalAccountType: string,
  changes: { ownerUserId?: string; visibility?: string },
): { ownerUserId?: string; visibility?: string } | null {
  if (finalAccountType !== "card") return null;
  const data = {
    ...(changes.ownerUserId !== undefined && { ownerUserId: changes.ownerUserId }),
    ...(changes.visibility !== undefined && { visibility: changes.visibility }),
  };
  return Object.keys(data).length > 0 ? data : null;
}

/** Applies edits made on the card account to its debt: name, payment
 *  settings, and what's owed now (a live value — see setLiveValues). */
export async function updateCardDebt(userId: string, debtId: string, changes: CardSettings & { name?: string }): Promise<void> {
  if (changes.owed !== undefined) await setLiveValues(userId, debtId, { balance: changes.owed });
  await prisma.debt.update({
    where: { id: debtId },
    data: {
      ...(changes.name !== undefined && { name: changes.name }),
      ...(changes.paymentMode !== undefined && { paymentMode: changes.paymentMode }),
      ...(changes.minimumPayment !== undefined && { minimumPayment: changes.minimumPayment }),
      ...(changes.paymentDueDay !== undefined && { paymentDueDay: changes.paymentDueDay }),
    },
  });
  if (changes.name !== undefined) {
    await prisma.allocation.updateMany({ where: { userId, debtId, type: "debt" }, data: { name: changes.name } });
  }
  await syncDebtAllocations(userId, await currentPeriod(userId), [debtId]);
}
