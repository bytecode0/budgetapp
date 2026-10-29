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
  // Statement import (shared/ingest/read.ts)
  unrecognized_columns: 'import.unrecognizedColumns',
  too_many_rows: 'import.tooManyRows',
  file_too_large: 'import.fileTooLarge',
  empty_file: 'import.emptyFile',
  no_movements: 'import.noMovements',
  invalid_rows: 'import.invalidRows',
  debt_not_found: 'import.debtNotFound',
  // Bank connection (server/routes/banking.ts), also as ?error=banking_… after the bank
  banking_disabled: 'banking.errors.disabled',
  banking_not_allowed: 'banking.errors.notAllowed',
  banking_not_found: 'banking.errors.notFound',
  banking_not_owner: 'banking.errors.notOwner',
  banking_expired: 'banking.errors.expired',
  banking_provider_failed: 'banking.errors.providerFailed',
  banking_sync_failed: 'banking.errors.syncFailed',
  banking_unknown_bank: 'banking.errors.unknownBank',
  banking_invalid_token: 'banking.errors.failed',
  banking_invalid_state: 'banking.errors.invalidState',
  banking_denied: 'banking.errors.denied',
  banking_failed: 'banking.errors.failed',
  banking_invalid_mappings: 'banking.errors.linkFailed',
  banking_unknown_account: 'banking.errors.linkFailed',
  banking_account_not_owned: 'banking.errors.accountNotOwned',
  banking_type_mismatch: 'banking.errors.typeMismatch',
  banking_duplicate_target: 'banking.errors.duplicateTarget',
  banking_account_not_linked: 'banking.errors.notLinked',
};

/** The message to show for a failed debt/account request (call it only once
 *  `result.error` is set; the hooks' results are unions with the success). */
export function apiErrorMessage(t: (key: string) => string, result: { error?: string; code?: string }): string {
  const key = result.code ? ERROR_KEYS[result.code] : undefined;
  return key ? t(key) : result.error ?? '';
}
