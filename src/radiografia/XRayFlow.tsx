import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import './xray-theme.css';
import { useXray } from './useXray';
import { XRayLanding } from './XRayLanding';
import { XRayQuickEstimate } from './XRayQuickEstimate';
import { XRayProcessing } from './XRayProcessing';
import { XRayResults } from './XRayResults';
import { XRayEmailCapture } from './XRayEmailCapture';
import { XRayClassify } from './XRayClassify';
import type { XRayResult, XRayStep, DebtKind, Overrides, MovementAnswer, IncomeAnswer } from './types';

// Only stop to ask when the ambiguous volume could actually change the verdict.
// Below this share of income it's noise, and the extra funnel step isn't worth it.
const CLASSIFY_THRESHOLD = 0.10;

export function XRayFlow() {
  const { i18n } = useTranslation();
  // The Radiografía always renders in Spanish. changeLanguage() only sets the
  // runtime i18n language — it does NOT write localStorage (no detector), so the
  // authenticated app's saved preference is untouched.
  useEffect(() => { if (i18n.language !== 'es') i18n.changeLanguage('es'); }, [i18n]);
  const lang = 'es';
  const { analyze, quickEstimate, addAccount, reclassify, submitLead, track } = useXray();

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
  // True only for a manual quick-estimate result (no statement uploaded) —
  // tells <XRayResults> to hide the sections that need real statement data
  // (hero summary, category breakdown). Cleared the moment a real statement
  // is analyzed (initial upload OR "add account" from the results screen).
  const [reduced, setReduced] = useState(false);
  // Answers to the mandatory classification gate, and the list it asks about —
  // frozen from the first result so rows can't shift under the user as each
  // answer re-runs the analysis.
  const [answers, setAnswers] = useState<Overrides>({});
  const [classifyBusy, setClassifyBusy] = useState(false);
  const [gate, setGate] = useState<{ outflow: XRayResult['uncertain']; income: XRayResult['income']['uncertain'] } | null>(null);

  const handleFiles = async (files: File[]) => {
    setError(null);
    setReady(false);
    setFailed(false);
    setResult(null);
    setReduced(false);
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
    setAnswers({});
    // Decide here, while we still have the pristine result: is the ambiguous
    // volume — outflow OR inflow — big enough that a verdict would be
    // dishonest without asking? Each direction is checked independently: an
    // ambiguous transfer OUT and an ambiguous cash deposit IN are unrelated,
    // either alone can be enough to distort the number.
    const { uncertain, income, summary } = res.result;
    const outflowMaterial = summary.totalIncome > 0
      && uncertain.total / summary.totalIncome >= CLASSIFY_THRESHOLD
      && uncertain.items.length > 0;
    // If confirmed income is 0 (everything so far is ambiguous/excluded), any
    // ambiguous inflow is trivially worth asking about — there's no honest
    // denominator yet to compare it against.
    const incomeMaterial = income.uncertain.items.length > 0
      && (summary.totalIncome === 0 || income.uncertain.total / summary.totalIncome >= CLASSIFY_THRESHOLD);
    const material = outflowMaterial || incomeMaterial;
    setGate(material ? { outflow: uncertain, income: income.uncertain } : null);
    setReady(true);
    track('analyze_completed', res.sessionId);
  };

  // Manual quick-estimate: pure arithmetic, no processing animation needed —
  // the form itself shows the pending state. Lands on the same 'results' step,
  // in reduced mode (only debts + the single debtLoad pillar are real).
  const handleQuickEstimate = async (
    monthlyIncome: number,
    debts: { name: string; kind: DebtKind; monthlyPayment: number }[],
  ): Promise<{ error?: string }> => {
    track('analyze_started');
    const res = await quickEstimate(monthlyIncome, debts);
    if (res.error || !res.result) return { error: res.error ?? 'generic' };
    setResult(res.result);
    setSessionId(res.sessionId ?? null);
    setResultsVersion(v => v + 1);
    setReduced(true);
    setStep('results');
    track('analyze_completed', res.sessionId);
    return {};
  };

  const handleAddAccount = async (files: File[]): Promise<{ error?: string }> => {
    if (!sessionId) return { error: 'network' };
    track('add_account', sessionId);
    const res = await addAccount(sessionId, files);
    if (res.error || !res.result) return { error: res.error ?? 'generic' };
    setResult(res.result);
    setResultsVersion(v => v + 1);
    setReduced(false); // a real statement was added → the full result is real now
    return {};
  };

  const handleLead = async (email: string) => {
    if (!sessionId) return { ok: false };
    const r = await submitLead(sessionId, email);
    if (r.ok) track('email_captured', sessionId);
    return r;
  };

  const handleReclassify = async (next: Overrides) => {
    if (!sessionId) return;
    const { result: updated } = await reclassify(sessionId, next);
    if (updated) setResult(updated);
  };

  // Gate answers: applied one at a time so the score is already correct by the
  // time the user reaches the results screen. Same handler for both outflow
  // and income answers — it just writes whatever value it's given.
  const handleClassifyAnswer = async (keys: string[], value: MovementAnswer | IncomeAnswer) => {
    // A row can stand for several amounts (the "assorted" bucket) — set them all.
    const next = { ...answers };
    for (const k of keys) next[k] = value;
    setAnswers(next);
    setClassifyBusy(true);
    await handleReclassify(next);
    setClassifyBusy(false);
  };

  return (
    <div className="xray-scope size-full bg-background overflow-y-auto">
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {step === 'landing' && (
            <XRayLanding onFiles={handleFiles} onManual={() => setStep('manual')} analyzing={step !== 'landing'} error={error} />
          )}
          {step === 'manual' && (
            <XRayQuickEstimate onSubmit={handleQuickEstimate} onBack={() => setStep('landing')} />
          )}
          {step === 'processing' && (
            <XRayProcessing
              ready={ready}
              failed={failed}
              onDone={() => {
                // Straight to the verdict only when it can be trusted; otherwise
                // resolve the ambiguous movements first.
                if (gate) { setStep('classify'); return; }
                track('results_viewed', sessionId);
                setStep('results');
              }}
              onFail={() => { setStep('landing'); }}
            />
          )}
          {step === 'classify' && gate && (
            <XRayClassify
              outflowItems={gate.outflow.items}
              outflowTotal={gate.outflow.total}
              incomeItems={gate.income.items}
              incomeTotal={gate.income.total}
              busy={classifyBusy}
              answers={answers}
              onAnswerOutflow={handleClassifyAnswer}
              onAnswerIncome={handleClassifyAnswer}
              onDone={() => {
                track('classify_completed', sessionId);
                track('results_viewed', sessionId);
                setStep('results');
              }}
            />
          )}
          {step === 'results' && result && (
            <XRayResults
              key={resultsVersion}
              result={result}
              reduced={reduced}
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
