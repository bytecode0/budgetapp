import { useCallback, useEffect, useState } from 'react';

// The "delete my account" request (server/routes/account.ts, LPBETA-09).
// Used by the banner on every screen and by the Settings panel: a change in
// one tells the others through a window event, so both always agree.
export interface DeletionState {
  requestedAt: string;
  /** The earliest moment the daily job deletes the account (request + 24 h). */
  dueAt: string;
}

export type ApiResult<T> = { data: T } | { error: string; code?: string };

const CHANGED = 'account-deletion-changed';

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: json.error ?? 'Request failed', code: json.code };
    return { data: json.data as T };
  } catch {
    return { error: 'Network error' };
  }
}

export function useAccountDeletion(enabled = true) {
  const [deletion, setDeletion] = useState<DeletionState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const result = await call<DeletionState | null>('GET', '/api/account/deletion');
    if ('data' in result) setDeletion(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const onChange = () => { refresh(); };
    window.addEventListener(CHANGED, onChange);
    return () => window.removeEventListener(CHANGED, onChange);
  }, [enabled, refresh]);

  const announce = () => window.dispatchEvent(new Event(CHANGED));

  const sendCode = () => call<{ sent: boolean }>('POST', '/api/account/deletion/code');

  const confirm = async (code: string) => {
    const result = await call<DeletionState | null>('POST', '/api/account/deletion', { code });
    if ('data' in result) announce();
    return result;
  };

  const cancel = async () => {
    const result = await call<null>('DELETE', '/api/account/deletion');
    if ('data' in result) announce();
    return result;
  };

  return { deletion, loading, sendCode, confirm, cancel };
}
