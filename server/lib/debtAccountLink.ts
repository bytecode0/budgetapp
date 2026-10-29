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
//     its debt).

export type DebtAccountLinkError = "card_already_has_debt";

/** Why `debtId` (undefined when creating) can't be linked to `account`, or null. */
export function debtAccountLinkError(
  debtId: string | undefined,
  account: { type: string },
  debtsOnAccount: { id: string }[],
): DebtAccountLinkError | null {
  if (account.type === "card" && debtsOnAccount.some(d => d.id !== debtId)) return "card_already_has_debt";
  return null;
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
