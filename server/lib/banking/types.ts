// Provider-agnostic boundary for Open Banking (PSD2 account information).
// Enable Banking is the only implementation (enableBanking.ts); this interface
// keeps that choice out of the routes, the sync and the Prisma schema.
//
// Money is integer cents and dates are calendar days ("yyyy-mm-dd"), as in the
// rest of the ingest pipeline (shared/ingest/types.ts).

/** A bank the user can connect. Enable Banking names a bank by name + country. */
export interface BankInstitution {
  name: string;
  country: string; // ISO 3166 alpha-2
  logo?: string;
  /** Longest consent the bank grants, in days. */
  maxConsentDays: number;
}

/** What the local account behind a provider account should be. */
export type BankAccountKind = "checking" | "savings" | "card";

export interface BankProviderAccount {
  id: string; // provider's account identifier (Enable Banking: uid within the session)
  name?: string;
  /** Last 4 characters of the IBAN only: the full IBAN never leaves the client. */
  ibanLast4?: string;
  currency: string;
  kind: BankAccountKind;
  /** Stable across consents (Enable Banking identification_hash), unlike `id`. */
  stableKey?: string;
}

export interface BankProviderBalance {
  amountCents: number; // signed, as the bank reports it
  currency: string;
  type: string; // provider's balance type (ISO 20022: CLBD, ITBD, CLAV…)
  /** Day the balance is as of, when the bank says (yyyy-mm-dd). */
  referenceDate?: string;
}

/** A BOOKED movement. Pending ones are never returned (they change or vanish). */
export interface BankProviderTxn {
  /** Provider's own id for the movement; null when the bank gives none. */
  id: string | null;
  date: string; // booking day, yyyy-mm-dd
  description: string;
  details?: string;
  /** Signed cents from the holder's point of view: negative = money out of the
   *  account / more owed on a card (from the credit/debit indicator). */
  amountCents: number;
  currency: string;
  balanceAfterCents?: number | null;
}

export interface BankTransactions {
  booked: BankProviderTxn[];
  /** Pending movements left out (counted, never imported). */
  pendingCount: number;
  /** Booked movements left out because the provider sent them malformed. */
  invalidCount: number;
}

export interface StartAuthorizationInput {
  institution: { name: string; country: string };
  /** Opaque value the provider echoes back to our callback. */
  state: string;
  /** Must equal a redirect URL registered with the provider. */
  redirectUrl: string;
  validUntil: Date;
  language?: string;
}

export interface BankSession {
  sessionId: string;
  accounts: BankProviderAccount[];
  validUntil: Date | null;
}

export interface BankSessionStatus {
  status: string; // Enable Banking: AUTHORIZED | EXPIRED | REVOKED | CLOSED | …
  authorized: boolean;
  accountIds: string[];
  validUntil: Date | null;
}

export interface BankingProviderClient {
  listInstitutions(country: string): Promise<BankInstitution[]>;
  /** Returns the bank's consent URL to send the user to. */
  startAuthorization(input: StartAuthorizationInput): Promise<{ url: string }>;
  /** Exchanges the code our callback received for a session. */
  createSession(code: string): Promise<BankSession>;
  getSession(sessionId: string): Promise<BankSessionStatus>;
  getAccount(accountId: string): Promise<BankProviderAccount>;
  getAccountBalance(accountId: string, kind: BankAccountKind): Promise<BankProviderBalance | null>;
  /** Booked movements since `dateFrom` (yyyy-mm-dd), every page. */
  getAccountTransactions(accountId: string, dateFrom: string): Promise<BankTransactions>;
  /** Revokes the consent at the provider. */
  deleteSession(sessionId: string): Promise<void>;
}
