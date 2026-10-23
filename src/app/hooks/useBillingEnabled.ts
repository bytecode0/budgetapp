import { useEffect, useState } from 'react';

// Whether Premium can be bought: the server reports if Stripe is configured
// (GET /api/stripe/status — off for the beta, plan §2.9). It depends on server
// env only, so one successful answer per page load is cached for every caller.
// A failed fetch is not cached, so the next mount retries.
let cached: boolean | null = null;
let inflight: Promise<boolean> | null = null;

function fetchBillingEnabled(): Promise<boolean> {
  inflight ??= fetch('/api/stripe/status', { credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) throw new Error('Failed to load billing status');
      const { data } = await res.json();
      cached = data?.enabled === true;
      return cached;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

// `active` gates the fetch on being authenticated (the endpoint requires
// requireAuth). While loading, on error or when inactive, billing counts as
// disabled: an upgrade button is never shown on uncertainty.
export function useBillingEnabled(active = true) {
  const [enabled, setEnabled] = useState(cached ?? false);
  const [loading, setLoading] = useState(cached === null);

  useEffect(() => {
    if (cached !== null) { setEnabled(cached); setLoading(false); return; }
    if (!active) return;
    let alive = true;
    fetchBillingEnabled()
      .then((value) => { if (alive) setEnabled(value); })
      .catch(() => { if (alive) setEnabled(false); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [active]);

  return { enabled, loading };
}
