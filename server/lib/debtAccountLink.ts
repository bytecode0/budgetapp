// Which account a debt may be linked to (Debt.accountId), decided as pure
// functions so the routes stay thin (unit-tested in debtAccountLink.test.ts).
//
// The linked account is not decoration: every expense on it without a debtId
// is a purchase that grows the debt, and it decides how payments split
// (server/lib/debtBalance.ts). So:
//   - A card account backs exactly ONE debt — the one the server creates and
//     keeps in step behind it (server/lib/cardDebt.ts). A second debt on the
//     same card would count every purchase twice.
//   - That card debt stays a credit_card: changing its kind would let it escape
//     the rules that keep it mirroring its card (and leave the card without
//     its debt). And the other way round: a credit_card debt only sits on a
//     card account — on any other account it would pass for a card's debt
//     (PATCH /api/accounts/:id) without being one.
//   - A debt and the account it is linked to have the SAME owner, whatever the
//     debt's kind: the account's purchases feed every linked debt's balance
//     and payment split, and a couple that unlinks splits the pool by owner
//     (server/lib/partnerUnlink.ts). A debt on the other partner's account
//     could not be split off without changing a balance on one side.

export type DebtAccountLinkError = "card_already_has_debt" | "debt_account_owner_mismatch" | "credit_card_needs_card_account";

/** A credit_card debt can't sit on an account that isn't a card. */
export function creditCardOnNonCardAccount(debtKind: string, accountType: string): boolean {
  return debtKind === "credit_card" && accountType !== "card";
}

/** Why the debt (`id` undefined when creating; `kind` as it will be saved)
 *  can't be linked to `account`, or null. */
export function debtAccountLinkError(
  debt: { id?: string; ownerUserId: string; kind: string },
  account: { type: string; ownerUserId: string },
  debtsOnAccount: { id: string }[],
): DebtAccountLinkError | null {
  if (account.ownerUserId !== debt.ownerUserId) return "debt_account_owner_mismatch";
  if (creditCardOnNonCardAccount(debt.kind, account.type)) return "credit_card_needs_card_account";
  if (account.type === "card" && debtsOnAccount.some(d => d.id !== debt.id)) return "card_already_has_debt";
  return null;
}

/** The debt that mirrors this account and follows it to a new owner: only a
 *  card account has one (a credit_card debt on another account is just a
 *  debt linked to it, which must keep its owner). */
export function mirroredCardDebtId(accountType: string, linkedCreditCardDebtId: string | null): string | null {
  return accountType === "card" ? linkedCreditCardDebtId : null;
}

/**
 * Whether giving an account to `newOwnerUserId` would leave a linked debt with
 * another owner. The card's own debt (`mirroredDebtId`) follows its card in
 * the same write (server/lib/cardDebt.ts cardDebtOwnershipChanges), so it
 * never does.
 */
export function ownerChangeSplitsDebtLink(
  newOwnerUserId: string,
  linkedDebts: { id: string; ownerUserId: string }[],
  mirroredDebtId: string | null,
): boolean {
  return linkedDebts.some(d => d.id !== mirroredDebtId && d.ownerUserId !== newOwnerUserId);
}

/** A card's own debt can't stop being a credit_card while it sits on its card. */
export function cardDebtKindLocked(
  existing: { kind: string; accountId: string | null },
  linkedAccountType: string | null,
  newKind: string | undefined,
): boolean {
  return existing.kind === "credit_card" && existing.accountId !== null && linkedAccountType === "card"
    && newKind !== undefined && newKind !== "credit_card";
}
