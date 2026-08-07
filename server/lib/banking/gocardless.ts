// GoCardless Bank Account Data (formerly Nordigen) client.
//
// Lazy-constructed and env-gated, mirroring server/lib/ai/client.ts: the rest
// of the app runs unchanged when no credentials are configured, and callers
// gate on bankingEnabled() the same way AI features gate on aiEnabled().
//
// NOTE: field names below follow GoCardless's documented Bank Account Data
// API v2 as of this writing (token/new, institutions, requisitions, accounts
// /balances, /transactions). Third-party APIs evolve — verify the exact
// response shape against https://developer.gocardless.com/bank-account-data
// before relying on this in production, especially the transaction/balance
// field names, which is the part most likely to drift.
import type {
  BankingProviderClient, BankInstitution, BankProviderAccount,
  BankProviderBalance, BankProviderTxn, CreateConnectionResult, ConnectionAccountsResult,
} from "./types.js";

const BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";

interface CachedToken { access: string; expiresAt: number }
let cachedToken: CachedToken | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.access;

  const res = await fetch(`${BASE_URL}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
  });
  if (!res.ok) throw new Error(`GoCardless auth failed: ${res.status} ${await res.text().catch(() => "")}`);
  const data = await res.json() as { access: string; access_expires: number };
  cachedToken = { access: data.access, expiresAt: Date.now() + data.access_expires * 1000 };
  return cachedToken.access;
}

async function authedFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GoCardless API error ${res.status} on ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

class GoCardlessClient implements BankingProviderClient {
  async listInstitutions(country: string): Promise<BankInstitution[]> {
    const data = await authedFetch<{ id: string; name: string; logo?: string }[]>(
      `/institutions/?country=${encodeURIComponent(country)}`,
    );
    return data.map(i => ({ id: i.id, name: i.name, logo: i.logo }));
  }

  async createConnection(institutionId: string, redirectUrl: string, reference: string): Promise<CreateConnectionResult> {
    const req = await authedFetch<{ id: string; link: string }>("/requisitions/", {
      method: "POST",
      body: JSON.stringify({
        institution_id: institutionId,
        redirect: redirectUrl,
        reference,
        user_language: "ES",
      }),
    });
    return { requisitionId: req.id, redirectUrl: req.link };
  }

  async getConnectionAccounts(requisitionId: string): Promise<ConnectionAccountsResult> {
    const req = await authedFetch<{ status: string; accounts: string[] }>(`/requisitions/${requisitionId}/`);
    const accounts: BankProviderAccount[] = req.accounts.map(id => ({ id, currency: "EUR" }));
    return { status: req.status, linked: req.status === "LN", accounts };
  }

  async getAccountBalance(accountId: string): Promise<BankProviderBalance | null> {
    const data = await authedFetch<{ balances: { balanceType: string; balanceAmount: { amount: string; currency: string } }[] }>(
      `/accounts/${accountId}/balances/`,
    );
    const balances = data.balances ?? [];
    const preferred = balances.find(b => b.balanceType === "interimAvailable") ?? balances[0];
    if (!preferred) return null;
    return { amount: parseFloat(preferred.balanceAmount.amount), currency: preferred.balanceAmount.currency };
  }

  async getAccountTransactions(accountId: string, sinceDate?: string): Promise<BankProviderTxn[]> {
    const qs = sinceDate ? `?date_from=${sinceDate}` : "";
    const data = await authedFetch<{
      transactions: { booked: Array<{
        transactionId?: string; internalTransactionId?: string;
        bookingDate?: string; valueDate?: string;
        remittanceInformationUnstructured?: string; creditorName?: string; debtorName?: string;
        transactionAmount: { amount: string; currency: string };
      }> };
    }>(`/accounts/${accountId}/transactions/${qs}`);

    return (data.transactions?.booked ?? []).map(t => ({
      id: t.transactionId ?? t.internalTransactionId ?? "",
      date: t.bookingDate ?? t.valueDate ?? "",
      description: t.remittanceInformationUnstructured || t.creditorName || t.debtorName || "",
      amount: parseFloat(t.transactionAmount.amount),
      currency: t.transactionAmount.currency,
    })).filter(t => t.id && t.date);
  }
}

let client: GoCardlessClient | null = null;

/** True when GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY are configured.
 *  The frontend gates its "Connect your bank" button on this, mirroring how
 *  AI buttons gate on aiEnabled(). */
export function bankingEnabled(): boolean {
  return !!(process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY);
}

export function getBankingClient(): BankingProviderClient | null {
  if (!bankingEnabled()) return null;
  return (client ??= new GoCardlessClient());
}
