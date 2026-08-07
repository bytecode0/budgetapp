// Provider-agnostic boundary for Open Banking. Only GoCardless Bank Account
// Data is implemented today (see gocardless.ts) — this interface exists so
// that choice never leaks into routes or the Prisma schema, not because a
// second provider is actually planned.

export interface BankInstitution {
  id: string;
  name: string;
  logo?: string;
}

export interface BankProviderAccount {
  id: string; // provider's account identifier
  iban?: string;
  name?: string;
  currency: string;
}

export interface BankProviderBalance {
  amount: number; // euros (already divided from the provider's minor-unit string)
  currency: string;
}

export interface BankProviderTxn {
  id: string; // provider's transaction identifier — used as the dedup key
  date: string; // ISO day (yyyy-mm-dd)
  description: string;
  amount: number; // euros, signed (negative = expense, positive = income)
  currency: string;
}

export interface CreateConnectionResult {
  requisitionId: string;
  redirectUrl: string; // where to send the user to complete bank consent
}

export interface ConnectionAccountsResult {
  status: string; // provider's own status string, e.g. "LN" (linked) for GoCardless
  linked: boolean;
  accounts: BankProviderAccount[];
}

export interface BankingProviderClient {
  listInstitutions(country: string): Promise<BankInstitution[]>;
  /** `redirectUrl` is OUR callback URL (with our own state embedded in the query string). */
  createConnection(institutionId: string, redirectUrl: string, reference: string): Promise<CreateConnectionResult>;
  getConnectionAccounts(requisitionId: string): Promise<ConnectionAccountsResult>;
  getAccountBalance(accountId: string): Promise<BankProviderBalance | null>;
  /** `sinceDate` is an ISO day; omit for the provider's default lookback window. */
  getAccountTransactions(accountId: string, sinceDate?: string): Promise<BankProviderTxn[]>;
}
