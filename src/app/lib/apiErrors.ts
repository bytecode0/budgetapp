// Translation keys for the `code` the debt and account routes send next to
// their `{ error }` (server/routes/debts.ts, server/routes/accounts.ts). The
// server's `error` text is English and only a fallback for unknown codes.
const ERROR_KEYS: Record<string, string> = {
  debt_has_payments: 'debts.hasPaymentsError',
  debt_account_locked: 'debts.accountLockedError',
  card_debt_kind_locked: 'debts.cardKindLockedError',
  card_debt_visibility_locked: 'debts.cardVisibilityLockedError',
  card_already_has_debt: 'debts.cardAlreadyHasDebtError',
  debt_account_owner_mismatch: 'debts.accountOwnerMismatchError',
  credit_card_needs_card_account: 'debts.creditCardNeedsCardAccountError',
  account_backs_debt: 'accounts.backsDebtError',
  account_backs_owner_debt: 'accounts.backsOwnerDebtError',
  card_has_movements: 'accounts.cardHasMovementsError',
};

/** The message to show for a failed debt/account request (call it only once
 *  `result.error` is set; the hooks' results are unions with the success). */
export function apiErrorMessage(t: (key: string) => string, result: { error?: string; code?: string }): string {
  const key = result.code ? ERROR_KEYS[result.code] : undefined;
  return key ? t(key) : result.error ?? '';
}
