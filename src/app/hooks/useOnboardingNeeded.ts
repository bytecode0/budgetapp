import { useState, useEffect, useCallback } from 'react';

// Wizard steps by index — mirrors ONBOARDING_STEPS in server/lib/onboarding.ts.
export const ONBOARDING_STEPS = [
  'welcome', 'income', 'savings', 'bank', 'cards', 'loans', 'fixed', 'flexible', 'result',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// Derived state, not a persisted flag (server/lib/onboarding.ts): if the user
// deletes what they configured, the wizard / checklist come back.
// `enabled` gates the fetch on being authenticated — the endpoint requires
// requireAuth, so calling it before the user is known just wastes a 401.
export function useOnboardingNeeded(enabled: boolean) {
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [missing, setMissing] = useState<OnboardingStep[]>([]);
  // The seeded checking account while still untouched (server/lib/onboarding.ts).
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/onboarding/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load onboarding status');
      const { data } = await res.json();
      setNeedsOnboarding(Boolean(data.needsOnboarding));
      setMissing(Array.isArray(data.missing) ? data.missing : []);
      setDefaultAccountId(typeof data.defaultAccountId === 'string' ? data.defaultAccountId : null);
    } catch {
      // Best-effort: if the check fails, don't block the user behind a wizard
      // they can't get past — fall through to the normal dashboard.
      setNeedsOnboarding(false);
      setMissing([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { needsOnboarding, missing, defaultAccountId, loading, refresh };
}
