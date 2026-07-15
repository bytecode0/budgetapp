import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { useXray } from './useXray';
import { XRayLanding } from './XRayLanding';
import { XRayProcessing } from './XRayProcessing';
import { XRayResults } from './XRayResults';
import { XRayEmailCapture } from './XRayEmailCapture';
import type { XRayResult, XRayStep } from './types';

export function XRayFlow() {
  const { i18n } = useTranslation();
  // The Radiografía always renders in Spanish. changeLanguage() only sets the
  // runtime i18n language — it does NOT write localStorage (no detector), so the
  // authenticated app's saved preference is untouched.
  useEffect(() => { if (i18n.language !== 'es') i18n.changeLanguage('es'); }, [i18n]);
  const lang = 'es';
  const { analyze, addAccount, reclassify, submitLead, track } = useXray();

  useEffect(() => { track('page_view'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [step, setStep] = useState<XRayStep>('landing');
  const [result, setResult] = useState<XRayResult | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped only on a fresh analysis (initial or add-account) so <XRayResults>
  // remounts and re-freezes its correction list. Reclassify must NOT bump it.
  const [resultsVersion, setResultsVersion] = useState(0);

  const handleFiles = async (files: File[]) => {
    setError(null);
    setReady(false);
    setFailed(false);
    setResult(null);
    setStep('processing');
    track('analyze_started');
    const res = await analyze(files);
    if (res.error || !res.result) {
      setFailed(true);
      setError(res.error ?? 'generic');
      return;
    }
    setResult(res.result);
    setSessionId(res.sessionId ?? null);
    setResultsVersion(v => v + 1);
    setReady(true);
    track('analyze_completed', res.sessionId);
  };

  const handleAddAccount = async (files: File[]): Promise<{ error?: string }> => {
    if (!sessionId) return { error: 'network' };
    track('add_account', sessionId);
    const res = await addAccount(sessionId, files);
    if (res.error || !res.result) return { error: res.error ?? 'generic' };
    setResult(res.result);
    setResultsVersion(v => v + 1);
    return {};
  };

  const handleLead = async (email: string) => {
    if (!sessionId) return { ok: false };
    const r = await submitLead(sessionId, email);
    if (r.ok) track('email_captured', sessionId);
    return r;
  };

  const handleReclassify = async (overrides: Record<string, 'consumption' | 'wealth'>) => {
    if (!sessionId) return;
    const { result: updated } = await reclassify(sessionId, overrides);
    if (updated) setResult(updated);
  };

  return (
    <div className="size-full bg-background overflow-y-auto">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {step === 'landing' && (
            <XRayLanding onFiles={handleFiles} analyzing={step !== 'landing'} error={error} />
          )}
          {step === 'processing' && (
            <XRayProcessing
              ready={ready}
              failed={failed}
              onDone={() => { track('results_viewed', sessionId); setStep('results'); }}
              onFail={() => { setStep('landing'); }}
            />
          )}
          {step === 'results' && result && (
            <XRayResults
              key={resultsVersion}
              result={result}
              lang={lang}
              sessionId={sessionId}
              track={track}
              onReclassify={handleReclassify}
              onAddAccount={handleAddAccount}
              onEmailCta={() => setStep('email')}
            />
          )}
          {step === 'email' && (
            <XRayEmailCapture
              onSubmit={handleLead}
              onCreateAccount={() => {
                // Hand the session to the authenticated app: AuthContext claims it
                // right after signup and hydrates the new account from these rows.
                track('account_cta_clicked', sessionId);
                if (sessionId) localStorage.setItem('xraySessionId', sessionId);
                window.location.href = '/';
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
