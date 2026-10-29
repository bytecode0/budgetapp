import { useState, useEffect, useCallback, useRef } from 'react';

// Wizard steps by index — mirrors ONBOARDING_STEPS in server/lib/onboarding.ts.
export const ONBOARDING_STEPS = [
  'welcome', 'income', 'savings', 'bank', 'cards', 'loans', 'fixed', 'flexible', 'result',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

// The user's stored "I have no credit cards" / "I have no loans" answers,
// which mark those setup steps done (PATCH /api/onboarding/answers).
export type OnboardingAnswer = 'noCards' | 'noLoans';
export type OnboardingAnswers = Record<OnboardingAnswer, boolean>;

export async function setOnboardingAnswer(answer: OnboardingAnswer, value: boolean): Promise<{ error?: string }> {
  try {
    const res = await fetch('/api/onboarding/answers', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [answer]: value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: typeof body.error === 'string' ? body.error : 'Failed to save' };
    return {};
  } catch {
    return { error: 'Failed to save' };
  }
}

// One answer, for the wizard's cards / loans steps: whether it's set, and a
// setter that keeps the local state in step with the server.
export function useOnboardingAnswer(answer: OnboardingAnswer) {
  const [answered, setAnswered] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/onboarding/status', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(body => { if (!cancelled && body?.data?.answers) setAnswered(Boolean(body.data.answers[answer])); })
      .catch(() => { /* best-effort: the button just shows unanswered */ });
    return () => { cancelled = true; };
  }, [answer]);

  const set = useCallback(async (value: boolean) => {
    setSaving(true);
    const result = await setOnboardingAnswer(answer, value);
    setSaving(false);
    if (!result.error) setAnswered(value);
    return result;
  }, [answer]);

  return { answered, saving, set };
}

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
  // `loading` covers only the first read: later refreshes run silently, so
  // re-reading the status never swaps the whole app for a spinner.
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) { loadedRef.current = false; setLoading(false); return; }
    if (!loadedRef.current) setLoading(true);
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
      loadedRef.current = true;
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  return { needsOnboarding, missing, defaultAccountId, loading, refresh };
}
