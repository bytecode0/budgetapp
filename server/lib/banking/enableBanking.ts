// Enable Banking client (https://enablebanking.com/docs/api/reference/).
//
// Auth: every request carries a short-lived JWT signed RS256 with the
// application's private key — header `kid` = application id, claims
// iss "enablebanking.com", aud "api.enablebanking.com", iat/exp (max 24 h; we
// use 1 h). No token is cached or stored.
//
// Flow: GET /aspsps → POST /auth (consent URL) → the user consents at the bank
// → our callback gets `code` → POST /sessions → accounts by uid →
// /accounts/{uid}/details | balances | transactions → DELETE /sessions/{id}.
//
// Errors never carry the private key, a JWT, a session id, an account uid, an
// IBAN or a response body: only the method, the endpoint template, the HTTP
// status and the provider's error code (an UPPER_CASE word) when it sends one.
import jwt from "jsonwebtoken";
import { bankingConfig, type BankingConfig } from "./config.js";
import type {
  BankAccountKind, BankInstitution, BankingProviderClient, BankProviderAccount, BankProviderBalance,
  BankProviderTxn, BankSession, BankSessionStatus, BankTransactions, StartAuthorizationInput,
} from "./types.js";

export const ENABLE_BANKING_API = "https://api.enablebanking.com";
const JWT_TTL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 20_000;
/** Pagination guard: a provider that keeps answering with a continuation key
 *  must not loop forever. */
export const MAX_TRANSACTION_PAGES = 50;

export class EnableBankingError extends Error {
  constructor(
    readonly status: number,
    readonly endpoint: string,
    readonly providerCode: string | null,
  ) {
    super(`Enable Banking ${endpoint} failed: HTTP ${status}${providerCode ? ` (${providerCode})` : ""}`);
    this.name = "EnableBankingError";
  }
}

/** The signed JWT for one request. Throws a clean error (never the key) when
 *  the key can't sign. */
export function enableBankingJwt(config: Pick<BankingConfig, "appId" | "privateKey">, nowSeconds = Math.floor(Date.now() / 1000)): string {
  try {
    return jwt.sign(
      { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nowSeconds, exp: nowSeconds + JWT_TTL_SECONDS },
      config.privateKey,
      { algorithm: "RS256", keyid: config.appId, header: { alg: "RS256", typ: "JWT", kid: config.appId } },
    );
  } catch {
    throw new Error("ENABLE_BANKING_PRIVATE_KEY is not a valid RSA private key");
  }
}

/** "12.34" | "-5" | "0.50" → cents. Null when it isn't a plain decimal or
 *  has sub-cent digits that aren't zero (never rounded silently). */
export function decimalToCents(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? "";
  if (frac.length > 2 && /[^0]/.test(frac.slice(2))) return null;
  const cents = Number(m[2]) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] === "-" ? -cents : cents;
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** CashAccountType → what the local account is. CARD = a card account
 *  (credit card); savings stay savings; everything else is a current account. */
export function accountKind(cashAccountType: unknown): BankAccountKind {
  if (cashAccountType === "CARD") return "card";
  if (cashAccountType === "SVGS") return "savings";
  return "checking";
}

interface RawAccount {
  uid?: string;
  account_id?: { iban?: string };
  name?: string;
  details?: string;
  product?: string;
  cash_account_type?: string;
  currency?: string;
  identification_hash?: string;
}

export function mapAccount(raw: RawAccount): BankProviderAccount | null {
  if (!raw || typeof raw.uid !== "string" || !raw.uid) return null;
  const iban = str(raw.account_id?.iban)?.replace(/\s+/g, "");
  return {
    id: raw.uid,
    name: str(raw.name) ?? str(raw.product) ?? str(raw.details),
    ...(iban ? { ibanLast4: iban.slice(-4) } : {}),
    currency: str(raw.currency) ?? "EUR",
    kind: accountKind(raw.cash_account_type),
    ...(str(raw.identification_hash) ? { stableKey: str(raw.identification_hash) } : {}),
  };
}

// Balance types in order of preference (ISO 20022 BalanceStatus). A card's
// balance is what's owed: only BOOKED balances, which match the booked
// movements we import — an "available" one is the unused credit limit.
const CARD_BALANCES = ["ITBD", "CLBD", "OPBD", "PRCD"];
const ACCOUNT_BALANCES = ["ITBD", "CLBD", "XPCD", "ITAV", "CLAV", "OPBD", "PRCD", "OTHR"];

interface RawBalance {
  balance_amount?: { amount?: string; currency?: string };
  balance_type?: string;
  reference_date?: string;
}

export function pickBalance(balances: RawBalance[], kind: BankAccountKind): BankProviderBalance | null {
  const order = kind === "card" ? CARD_BALANCES : ACCOUNT_BALANCES;
  for (const type of order) {
    const candidates = balances
      .filter(b => b?.balance_type === type && decimalToCents(b.balance_amount?.amount) !== null)
      .sort((a, b) => (b.reference_date ?? "").localeCompare(a.reference_date ?? ""));
    const best = candidates[0];
    if (best) return { amountCents: decimalToCents(best.balance_amount!.amount)!, currency: str(best.balance_amount?.currency) ?? "EUR", type };
  }
  return null;
}

interface RawTxn {
  transaction_id?: string | null;
  entry_reference?: string | null;
  transaction_amount?: { amount?: string; currency?: string };
  credit_debit_indicator?: string;
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  remittance_information?: string[] | null;
  bank_transaction_code?: { description?: string } | null;
  balance_after_transaction?: { amount?: string } | null;
  note?: string | null;
}

/** One BOOKED provider movement → ours, or null when it can't be read safely
 *  (no direction, no amount, no date). The sign comes only from
 *  credit_debit_indicator: DBIT = money out (negative), CRDT = money in. */
export function mapTransaction(raw: RawTxn): BankProviderTxn | null {
  const cents = decimalToCents(raw.transaction_amount?.amount);
  if (cents === null) return null;
  const sign = raw.credit_debit_indicator === "DBIT" ? -1 : raw.credit_debit_indicator === "CRDT" ? 1 : 0;
  if (sign === 0) return null;
  const day = [raw.booking_date, raw.value_date, raw.transaction_date].find(isDay);
  if (!day) return null;

  // The counterparty names the merchant best; the remittance text is the
  // bank's own wording. Both are kept: the first as description, the rest as
  // details (used for classification and search, never for the merchant key).
  const counterparty = str(sign < 0 ? raw.creditor?.name : raw.debtor?.name);
  const remittance = (Array.isArray(raw.remittance_information) ? raw.remittance_information : [])
    .map(str).filter((s): s is string => !!s).join(" ");
  const code = str(raw.bank_transaction_code?.description);
  const description = counterparty ?? (remittance || code || str(raw.note) || "");
  const details = [counterparty ? remittance : "", code && code !== description ? code : ""].filter(Boolean).join(" · ");
  const balance = decimalToCents(raw.balance_after_transaction?.amount);
  const id = str(raw.transaction_id ?? undefined) ?? str(raw.entry_reference ?? undefined) ?? null;
  return {
    id,
    date: day,
    description,
    ...(details ? { details } : {}),
    amountCents: sign * Math.abs(cents),
    currency: str(raw.transaction_amount?.currency) ?? "EUR",
    balanceAfterCents: balance,
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class EnableBankingClient implements BankingProviderClient {
  constructor(
    private readonly config: BankingConfig,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  /** `endpoint` is the path TEMPLATE used in errors (no ids in messages). */
  private async request<T>(method: string, path: string, endpoint: string, opts: { query?: Record<string, string | undefined>; body?: unknown } = {}): Promise<T> {
    const url = new URL(ENABLE_BANKING_API + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${enableBankingJwt(this.config)}`,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes("RSA private key")) throw err;
      throw new EnableBankingError(0, `${method} ${endpoint}`, null);
    }
    if (!res.ok) {
      let code: string | null = null;
      try {
        const body = await res.json() as { error?: unknown };
        if (typeof body?.error === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(body.error)) code = body.error;
      } catch { /* no JSON body */ }
      throw new EnableBankingError(res.status, `${method} ${endpoint}`, code);
    }
    return res.json() as Promise<T>;
  }

  async listInstitutions(country: string): Promise<BankInstitution[]> {
    const data = await this.request<{ aspsps?: { name?: string; country?: string; logo?: string; psu_types?: string[]; maximum_consent_validity?: number }[] }>(
      "GET", "/aspsps", "/aspsps", { query: { country, psu_type: "personal" } },
    );
    return (data.aspsps ?? [])
      .filter(a => typeof a.name === "string" && typeof a.country === "string"
        && (!Array.isArray(a.psu_types) || a.psu_types.includes("personal")))
      .map(a => ({
        name: a.name!,
        country: a.country!,
        ...(a.logo ? { logo: a.logo } : {}),
        maxConsentDays: typeof a.maximum_consent_validity === "number" && a.maximum_consent_validity > 0
          ? Math.floor(a.maximum_consent_validity / 86400)
          : 90,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async startAuthorization(input: StartAuthorizationInput): Promise<{ url: string }> {
    const data = await this.request<{ url?: string }>("POST", "/auth", "/auth", {
      body: {
        // Both asked for explicitly: the API documents no default.
        access: { valid_until: input.validUntil.toISOString(), balances: true, transactions: true },
        aspsp: { name: input.institution.name, country: input.institution.country },
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: "personal",
        ...(input.language ? { language: input.language } : {}),
      },
    });
    if (!data.url) throw new EnableBankingError(502, "POST /auth", "NO_URL");
    return { url: data.url };
  }

  async createSession(code: string): Promise<BankSession> {
    const data = await this.request<{ session_id?: string; accounts?: RawAccount[]; access?: { valid_until?: string } }>(
      "POST", "/sessions", "/sessions", { body: { code } },
    );
    if (!data.session_id) throw new EnableBankingError(502, "POST /sessions", "NO_SESSION");
    return {
      sessionId: data.session_id,
      accounts: (data.accounts ?? []).map(mapAccount).filter((a): a is BankProviderAccount => !!a),
      validUntil: date(data.access?.valid_until),
    };
  }

  async getSession(sessionId: string): Promise<BankSessionStatus> {
    const data = await this.request<{ status?: string; accounts?: string[]; access?: { valid_until?: string } }>(
      "GET", `/sessions/${encodeURIComponent(sessionId)}`, "/sessions/{id}",
    );
    const status = data.status ?? "UNKNOWN";
    return {
      status,
      authorized: status === "AUTHORIZED",
      accountIds: (data.accounts ?? []).filter((a): a is string => typeof a === "string"),
      validUntil: date(data.access?.valid_until),
    };
  }

  async getAccount(accountId: string): Promise<BankProviderAccount> {
    const raw = await this.request<RawAccount>("GET", `/accounts/${encodeURIComponent(accountId)}/details`, "/accounts/{uid}/details");
    const account = mapAccount({ ...raw, uid: raw.uid ?? accountId });
    if (!account) throw new EnableBankingError(502, "GET /accounts/{uid}/details", "NO_ACCOUNT");
    return account;
  }

  async getAccountBalance(accountId: string, kind: BankAccountKind): Promise<BankProviderBalance | null> {
    const data = await this.request<{ balances?: RawBalance[] }>(
      "GET", `/accounts/${encodeURIComponent(accountId)}/balances`, "/accounts/{uid}/balances",
    );
    return pickBalance(data.balances ?? [], kind);
  }

  async getAccountTransactions(accountId: string, dateFrom: string): Promise<BankTransactions> {
    const out: BankTransactions = { booked: [], pendingCount: 0, invalidCount: 0 };
    let continuationKey: string | undefined;
    for (let page = 0; page < MAX_TRANSACTION_PAGES; page++) {
      const data = await this.request<{ transactions?: RawTxn[]; continuation_key?: string | null }>(
        "GET", `/accounts/${encodeURIComponent(accountId)}/transactions`, "/accounts/{uid}/transactions",
        { query: { date_from: dateFrom, continuation_key: continuationKey } },
      );
      for (const raw of data.transactions ?? []) {
        if (raw?.status !== "BOOK") { out.pendingCount++; continue; }
        const txn = mapTransaction(raw);
        if (txn) out.booked.push(txn); else out.invalidCount++;
      }
      continuationKey = data.continuation_key || undefined;
      if (!continuationKey) return out;
    }
    throw new EnableBankingError(502, "GET /accounts/{uid}/transactions", "TOO_MANY_PAGES");
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`, "/sessions/{id}");
  }
}

/** The client for the current configuration, or null when banking is off. */
export function getBankingClient(): BankingProviderClient | null {
  const config = bankingConfig();
  return config ? new EnableBankingClient(config) : null;
}
