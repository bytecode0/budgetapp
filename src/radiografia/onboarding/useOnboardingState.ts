import { useEffect, useRef, useState } from 'react';
import { bootstrapProfile, fetchProfile, saveStep } from './onboardingApi';
import type { Block1Draft } from './Block1Form';

export type OnboardingStep = 'block1' | 'block2_email' | 'block3_enrichment' | 'result';

const STORAGE_STEP = 'radiografia_v2:step';
const STORAGE_TOKEN = 'radiografia_v2:accessToken';
const STORAGE_DRAFT = 'radiografia_v2:block1draft';

// Before an email is confirmed there's nothing legitimate to persist
// server-side about an anonymous visitor beyond onboardingStep (plan §2.5
// point 1) — so the Block 1 draft lives ONLY in sessionStorage until
// email_verified flips it to true, at which point it's pushed to
// /profile/fields once (see OnboardingFlow's onEmailVerified).
export function loadDraft(): Block1Draft | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_DRAFT);
    return raw ? (JSON.parse(raw) as Block1Draft) : null;
  } catch {
    return null;
  }
}
export function saveDraft(draft: Block1Draft) {
  sessionStorage.setItem(STORAGE_DRAFT, JSON.stringify(draft));
}
export function clearDraft() {
  sessionStorage.removeItem(STORAGE_DRAFT);
}

export function useOnboardingState() {
  const [step, setStepState] = useState<OnboardingStep>(() => {
    const saved = sessionStorage.getItem(STORAGE_STEP);
    return (saved as OnboardingStep) || 'block1';
  });
  const [accessToken, setAccessTokenState] = useState<string | null>(() => sessionStorage.getItem(STORAGE_TOKEN));
  const [emailVerified, setEmailVerified] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const setAccessToken = (token: string | null) => {
    setAccessTokenState(token);
    if (token) sessionStorage.setItem(STORAGE_TOKEN, token);
    else sessionStorage.removeItem(STORAGE_TOKEN);
  };

  const setStep = (next: OnboardingStep) => {
    setStepState(next);
    sessionStorage.setItem(STORAGE_STEP, next);
    // Read the token from sessionStorage, not the `accessToken` state closure:
    // a caller that just verified email calls setAccessToken() and setStep()
    // back-to-back in the same tick, and React hasn't re-rendered yet — the
    // closure here would still see the old (null) token. setAccessToken
    // writes to sessionStorage synchronously, so this always sees the latest.
    const token = sessionStorage.getItem(STORAGE_TOKEN);
    saveStep(next, token); // fire-and-forget: a failed write here only costs a resume-position, never data
  };

  // On mount: with a token (returning tab/device, or a fresh page load after
  // verify) ask the server where we left off — it's the source of truth for
  // step position once an email exists. Without one, bootstrap/resume the
  // anonymous profile by cookie; its onboardingStep is always null pre-email,
  // so the locally-saved step (if any) wins.
  //
  // A `?t=` query param is the entry point for resuming on a device that has
  // no sessionStorage of its own — the same mechanism a future magic-link
  // email would link to. Stripped from the URL immediately so the token
  // doesn't linger in browser history or get sent in a Referer header.
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const urlToken = new URLSearchParams(window.location.search).get('t');
      if (urlToken) {
        sessionStorage.setItem(STORAGE_TOKEN, urlToken);
        setAccessTokenState(urlToken);
        window.history.replaceState({}, '', window.location.pathname);
      }
      const token = urlToken ?? sessionStorage.getItem(STORAGE_TOKEN);
      if (token) {
        const { data } = await fetchProfile(token);
        if (data) {
          setEmailVerified(data.emailVerified);
          setEmail(data.email ?? null);
          setStageId(data.stageId ?? null);
          if (data.onboardingStep) {
            setStepState(data.onboardingStep as OnboardingStep);
            sessionStorage.setItem(STORAGE_STEP, data.onboardingStep);
          }
          setLoading(false);
          return;
        }
      }
      await bootstrapProfile(null);
      setLoading(false);
    })();
  }, []);

  return { step, setStep, accessToken, setAccessToken, emailVerified, setEmailVerified, email, setEmail, stageId, setStageId, branchId, setBranchId, loading };
}
