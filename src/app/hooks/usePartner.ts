import { useState, useEffect, useCallback } from 'react';

export type PartnerState =
  | 'none'
  | 'invite_pending'
  | 'linked_primary'
  | 'linked_secondary';

export interface PartnerStatus {
  state: PartnerState;
  linkedTo?: { name: string; email: string };       // linked_secondary
  linkedPartner?: { name: string; email: string };  // linked_primary
  pendingInvite?: { email: string; expiresAt: string }; // invite_pending
}

export interface InviteDetails {
  invitedEmail: string;
  senderName: string;
  senderEmail: string;
}

export function usePartner() {
  const [status, setStatus] = useState<PartnerStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/partner/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus({ state: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const sendInvite = async (email: string) => {
    const res = await fetch('/api/partner/invite', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to send invite' };
    await fetchStatus();
    return { warning: data.warning as string | undefined, acceptUrl: data.acceptUrl as string | undefined };
  };

  const cancelInvite = async () => {
    const res = await fetch('/api/partner/invite', {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) return { error: 'Failed to cancel invite' };
    await fetchStatus();
    return {};
  };

  const unlink = async () => {
    const res = await fetch('/api/partner/unlink', {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to unlink' };
    await fetchStatus();
    return {};
  };

  const acceptInvite = async (token: string) => {
    const res = await fetch('/api/partner/accept', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) return { error: data.error || 'Failed to accept invite' };
    await fetchStatus();
    return { linkedTo: data.linkedTo };
  };

  return { status, loading, fetchStatus, sendInvite, cancelInvite, unlink, acceptInvite };
}

export async function fetchInviteDetails(token: string): Promise<InviteDetails | null> {
  try {
    const res = await fetch(`/api/partner/invite/${token}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.invite;
  } catch {
    return null;
  }
}
