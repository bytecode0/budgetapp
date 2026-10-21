import { useState, useEffect, useCallback } from 'react';

// Derived state, not a persisted flag: if the user later deletes their income,
// debts and budget, this must flip back to true so the onboarding wizard
// reappears — see server/routes/onboarding.ts.
// `enabled` gates the fetch on being authenticated — the endpoint requires
// requireAuth, so calling it before the user is known just wastes a 401.
export function useOnboardingNeeded(enabled: boolean) {
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/onboarding/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load onboarding status');
      const data = await res.json();
      setNeedsOnboarding(Boolean(data.needsOnboarding));
    } catch {
      // Best-effort: if the check fails, don't block the user behind a wizard
      // they can't get past — fall through to the normal dashboard.
      setNeedsOnboarding(false);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { needsOnboarding, loading, refresh };
}
