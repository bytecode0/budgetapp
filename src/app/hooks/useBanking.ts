import { useState, useEffect, useCallback } from 'react';
import type { ImportPreview, ImportSummary, ConfirmRow } from './useImport';

// Bank connection (Enable Banking, server/routes/banking.ts). Every response
// is { data } or { error, code }; the codes are translated by apiErrors.ts.

export interface BankInstitution { name: string; country: string; logo: string | null }
export type BankAccountKind = 'checking' | 'savings' | 'card';
export interface BankAccount {
  id: string;
  name?: string;
  ibanLast4?: string;
  currency: string;
  kind: BankAccountKind;
  /** The local account already linked to it, if any. */
  linkedAccountId: string | null;
}
export interface BankLinkedAccount {
  id: string;
  name: string;
  type: string;
  bankReviewedAt: string | null;
  bankPendingReview: number;
}
export interface BankConnection {
  id: string;
  institutionName: string;
  institutionCountry: string | null;
  status: 'pending' | 'active' | 'expired' | 'error';
  isOwner: boolean;
  consentGivenAt: string | null;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  accounts: BankLinkedAccount[];
  debts: { id: string; name: string }[];
}
export interface BankAccountsResult { connectionId: string; institutionName: string; accounts: BankAccount[] }
export type LinkMapping = { externalAccountId: string; accountId?: string; create?: { name: string; type: string } };
export type BankResult<T> = { ok: false; error: string; code?: string } | ({ ok: true } & T);

async function call<T>(url: string, init?: RequestInit): Promise<BankResult<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? 'Request failed', code: body.code };
    return { ok: true, ...(body.data as T) };
  } catch {
    return { ok: false, error: 'Network error' };
  }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export function useBanking() {
  const [enabled, setEnabled] = useState(false);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConnections = useCallback(async () => {
    const res = await call<{ connections: BankConnection[] }>('/api/banking/connections');
    if (res.ok) setConnections(res.connections);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Hidden entirely unless the server says this user may use it.
    call<{ enabled: boolean }>('/api/banking/status').then(res => {
      const on = res.ok && res.enabled;
      setEnabled(on);
      if (on) fetchConnections(); else setLoading(false);
    });
  }, [fetchConnections]);

  const fetchInstitutions = (country = 'ES') =>
    call<{ institutions: BankInstitution[] }>(`/api/banking/institutions?country=${country}`);

  /** Starts (or renews) consent and sends the browser to the bank. */
  const connect = async (target: { name: string; country: string } | { connectionId: string }, lang: string) => {
    const res = await call<{ url: string }>('/api/banking/connect', post({ ...target, lang }));
    if (res.ok) window.location.href = res.url;
    return res;
  };

  const exchange = (token: string) => call<BankAccountsResult>('/api/banking/exchange', post({ token }));

  const bankAccounts = (connectionId: string) => call<BankAccountsResult>(`/api/banking/connections/${connectionId}/bank-accounts`);

  const linkAccounts = async (connectionId: string, mappings: LinkMapping[]) => {
    const res = await call<{ linked: number; accountIds: string[] }>(`/api/banking/connections/${connectionId}/link-accounts`, post({ mappings }));
    if (res.ok) await fetchConnections();
    return res;
  };

  const preview = (connectionId: string, accountId: string) =>
    call<ImportPreview & { accountId: string; pendingCount: number }>(`/api/banking/connections/${connectionId}/preview?accountId=${encodeURIComponent(accountId)}`);

  /** Same contract as useImport().confirm, so the import preview step can use it. */
  const confirm = async (connectionId: string, accountId: string, rows: ConfirmRow[], dismissed: string[]) => {
    const res = await call<{ inserted: number; summary: ImportSummary }>(`/api/banking/connections/${connectionId}/confirm`, post({ accountId, rows, dismissed }));
    if (res.ok) await fetchConnections();
    return res;
  };

  const syncNow = async (connectionId: string) => {
    const res = await call<{ written: number; held: number; awaitingFirstReview: number }>(`/api/banking/connections/${connectionId}/sync`, { method: 'POST' });
    await fetchConnections();
    return res;
  };

  const disconnect = async (connectionId: string) => {
    const res = await call<{ revoked: boolean }>(`/api/banking/connections/${connectionId}`, { method: 'DELETE' });
    if (res.ok) await fetchConnections();
    return res;
  };

  return { enabled, connections, loading, fetchConnections, fetchInstitutions, connect, exchange, bankAccounts, linkAccounts, preview, confirm, syncNow, disconnect };
}
