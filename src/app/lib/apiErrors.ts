// Translation keys for the `code` the debt, account and expense routes send
// next to their `{ error }` (server/routes/debts.ts, accounts.ts, expenses.ts,
// server/lib/poolRefs.ts). The
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
  paid_from_card: 'debts.paidFromCardError',
  refund_on_debt_line: 'apiErrors.refundOnDebtLine',
  allocation_not_found: 'apiErrors.allocationNotFound',
  account_not_found: 'apiErrors.accountNotFound',
  // Statement import (server/lib/ingest/read.ts)
  unrecognized_columns: 'import.unrecognizedColumns',
  too_many_rows: 'import.tooManyRows',
  file_too_large: 'import.fileTooLarge',
  empty_file: 'import.emptyFile',
  no_movements: 'import.noMovements',
  invalid_rows: 'import.invalidRows',
  debt_not_found: 'import.debtNotFound',
};

/** The message to show for a failed debt/account request (call it only once
 *  `result.error` is set; the hooks' results are unions with the success). */
export function apiErrorMessage(t: (key: string) => string, result: { error?: string; code?: string }): string {
  const key = result.code ? ERROR_KEYS[result.code] : undefined;
  return key ? t(key) : result.error ?? '';
}
