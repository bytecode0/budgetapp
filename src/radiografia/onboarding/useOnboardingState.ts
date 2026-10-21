import { useEffect, useRef, useState } from 'react';
import { bootstrapProfile, fetchProfile, saveStep, type ExtractoDetected, type InsightNames } from './onboardingApi';
import { trackPlausible } from '../analytics';
import type { Block1Draft } from './block1Draft';

export type OnboardingStep = 'upload' | 'context' | 'email' | 'result';

const STORAGE_STEP = 'radiografia_v2:step';
const STORAGE_TOKEN = 'radiografia_v2:accessToken';
const STORAGE_DRAFT = 'radiografia_v2:block1draft';
const STORAGE_DETECTION = 'radiografia_v2:detection';
const ONBOARDING_STEPS: OnboardingStep[] = ['upload', 'context', 'email', 'result'];

function toOnboardingStep(value: string | null | undefined): OnboardingStep {
  if (value && ONBOARDING_STEPS.includes(value as OnboardingStep)) return value as OnboardingStep;
  // Profiles created during the earlier manual-first rollout should resume in
  // the new compact context step rather than land on a removed screen.
  return value ? 'context' : 'upload';
}

// The statement upload stopped being skippable (A3): nobody should be able to
// resume at 'context' or later without server-side evidence they actually
// went through it. This clamps whatever step the server (or a stale
// sessionStorage from before this change) claims down to 'upload' when
// there's no proof — the server's `hasExtracto`, never the client's own
// memory of where it left off, is what decides this.
function clampToExtracto(step: OnboardingStep, hasExtracto: boolean): OnboardingStep {
  return step === 'upload' || hasExtracto ? step : 'upload';
}

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
  sessionStorage.removeItem(STORAGE_DETECTION);
}

// The statement read and the list of fields it filled in, kept beside the
// draft for the same reason and with the same lifetime. Without this a refresh
// left the context step showing prefilled amounts with no indication of where
// they came from, and sent "back" to an empty drop zone even though the draft
// itself had survived. Same figures the draft already holds — no extra
// exposure, and cleared by clearDraft() on email confirmation.
export interface DetectionState {
  detected: ExtractoDetected;
  prefilled: string[];
  insightNames: InsightNames | null;
}
export function loadDetection(): DetectionState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_DETECTION);
    return raw ? (JSON.parse(raw) as DetectionState) : null;
  } catch {
    return null;
  }
}
export function saveDetection(state: DetectionState) {
  sessionStorage.setItem(STORAGE_DETECTION, JSON.stringify(state));
}

export function useOnboardingState() {
  const [step, setStepState] = useState<OnboardingStep>(() => {
    const saved = sessionStorage.getItem(STORAGE_STEP);
    return toOnboardingStep(saved);
  });
  const [accessToken, setAccessTokenState] = useState<string | null>(() => sessionStorage.getItem(STORAGE_TOKEN));
  const [emailVerified, setEmailVerified] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [reportToken, setReportToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  const setAccessToken = (token: string | null) => {
    setAccessTokenState(token);
    if (token) sessionStorage.setItem(STORAGE_TOKEN, token);
    else sessionStorage.removeItem(STORAGE_TOKEN);
  };

  const setStep = (next: OnboardingStep) => {
    // Same forward-only guard as the server's own paso_completado write
    // (PATCH /profile/step) — comparing against `step` before it's replaced.
    // Keeps the Plausible funnel and the DB funnel counting the same thing:
    // volver atrás and re-advancing never fires this a second time.
    if (ONBOARDING_STEPS.indexOf(next) > ONBOARDING_STEPS.indexOf(step)) {
      trackPlausible('paso_completado', { paso: ONBOARDING_STEPS.indexOf(next) + 1 });
    }
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
  // so the locally-saved step (if any) wins, subject to the hasExtracto clamp
  // above.
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
          setReportToken(data.reportToken ?? null);
          const resumed = clampToExtracto(toOnboardingStep(data.onboardingStep), data.hasExtracto);
          setStepState(resumed);
          sessionStorage.setItem(STORAGE_STEP, resumed);
          setLoading(false);
          return;
        }
      }
      // Pre-email, the anon cookie is the only identity — but sessionStorage's
      // own step can predate the statement becoming mandatory (or belong to a
      // stale tab that used the since-removed "skip" button). Clamp it the
      // same way the token branch does.
      const { data } = await bootstrapProfile(null);
      if (data) {
        const resumed = clampToExtracto(toOnboardingStep(sessionStorage.getItem(STORAGE_STEP)), data.hasExtracto);
        setStepState(resumed);
        sessionStorage.setItem(STORAGE_STEP, resumed);
      }
      setLoading(false);
    })();
  }, []);

  return { step, setStep, accessToken, setAccessToken, emailVerified, setEmailVerified, email, setEmail, stageId, setStageId, branchId, setBranchId, reportToken, setReportToken, loading };
}
