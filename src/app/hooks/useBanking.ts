import { useState, useEffect, useCallback } from 'react';

export interface BankInstitution { id: string; name: string; logo?: string }
export interface BankProviderAccount { id: string; iban?: string; name?: string; currency: string }
export interface BankConnection {
  id: string;
  institutionId: string;
  institutionName: string;
  status: 'pending' | 'active' | 'expired' | 'error';
  consentGivenAt: string | null;
  expiresAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  accounts: { id: string; name: string }[];
  debts: { id: string; name: string }[];
}

export function useBanking() {
  const [enabled, setEnabled] = useState(false);
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/banking/status', { credentials: 'include' });
      if (res.ok) setEnabled((await res.json()).enabled);
    } catch { /* best-effort */ }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/banking/connections', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setConnections(data.connections ?? []);
    } catch { /* best-effort */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); fetchConnections(); }, [fetchStatus, fetchConnections]);

  const fetchInstitutions = async (country = 'ES'): Promise<BankInstitution[]> => {
    const res = await fetch(`/api/banking/institutions?country=${country}`, { credentials: 'include' });
    if (!res.ok) return [];
    return (await res.json()).institutions ?? [];
  };

  /** Kicks off the consent flow — navigates the browser to the bank's redirect URL. */
  const connect = async (institutionId: string, institutionName: string): Promise<{ error?: string }> => {
    const res = await fetch('/api/banking/connect', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ institutionId, institutionName }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to start bank connection' };
    window.location.href = data.redirectUrl;
    return {};
  };

  /** Resolves the opaque token from the post-consent redirect (?bankToken=...). */
  const exchange = async (token: string): Promise<{ error?: string; connectionId?: string; institutionName?: string; accounts?: BankProviderAccount[] }> => {
    const res = await fetch('/api/banking/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to complete bank connection' };
    return data;
  };

  const linkAccounts = async (
    connectionId: string,
    mappings: { externalAccountId: string; accountId?: string; create?: { name: string; type?: string } }[],
  ) => {
    const res = await fetch(`/api/banking/connections/${connectionId}/link-accounts`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to link accounts' };
    await fetchConnections();
    return { linked: data.linked as number };
  };

  const syncNow = async (connectionId: string) => {
    const res = await fetch(`/api/banking/connections/${connectionId}/sync`, { method: 'POST', credentials: 'include' });
    const data = await res.json();
    if (!res.ok || !data.ok) return { error: data.error || 'Sync failed' };
    await fetchConnections();
    return { expenses: data.expenses as number, income: data.income as number };
  };

  /** Reconnects a lapsed connection — reuses the same row (Phase 5), so this
   *  is just connect() called with the connection's own institution again. */
  const reconnect = (c: BankConnection) => connect(c.institutionId, c.institutionName);

  return { enabled, connections, loading, fetchInstitutions, connect, exchange, linkAccounts, fetchConnections, syncNow, reconnect };
}
