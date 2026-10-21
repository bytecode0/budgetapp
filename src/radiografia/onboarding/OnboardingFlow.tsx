import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import '../xray-theme.css';
import { ensurePlausibleLoaded, trackPlausible } from '../analytics';
import { useOnboardingState, loadDraft, saveDraft, clearDraft, loadDetection, saveDetection } from './useOnboardingState';
import { emptyBlock1Draft, draftToPayload, type Block1Draft } from './block1Draft';
import { EmailBlock } from './EmailBlock';
import { EnrichmentBlock } from './EnrichmentBlock';
import { FinancialContextBlock } from './FinancialContextBlock';
import { ResultPlaceholder } from './ResultPlaceholder';
import { resendReport, saveFields, type ExtractoDetected, type InsightNames } from './onboardingApi';

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export function OnboardingFlow() {
  const { i18n, t } = useTranslation();
  useEffect(() => { if (i18n.language !== 'es') i18n.changeLanguage('es'); }, [i18n]);
  useEffect(() => { ensurePlausibleLoaded(); }, []);

  const { step, setStep, accessToken, setAccessToken, emailVerified, setEmailVerified, email, setEmail, stageId, setStageId, branchId, setBranchId, reportToken, setReportToken, loading } = useOnboardingState();
  const [draft, setDraft] = useState<Block1Draft>(() => loadDraft() ?? emptyBlock1Draft());
  const [submitting, setSubmitting] = useState(false);
  const [reportSent, setReportSent] = useState<boolean | null>(null);
  // Held here, not inside EnrichmentBlock, so that stepping back from the
  // context screen returns to the review of an already-read statement instead
  // of an empty drop zone.
  const [detected, setDetected] = useState<ExtractoDetected | null>(() => loadDetection()?.detected ?? null);
  const [prefilled, setPrefilled] = useState<string[]>(() => loadDetection()?.prefilled ?? []);
  const [insightNames, setInsightNames] = useState<InsightNames | null>(() => loadDetection()?.insightNames ?? null);

  const updateDraft = (next: Block1Draft) => { setDraft(next); saveDraft(next); };

  const updateDetected = (next: ExtractoDetected, names?: InsightNames) => {
    setDetected(next);
    const resolvedNames = names ?? insightNames;
    if (names) setInsightNames(names);
    saveDetection({ detected: next, prefilled, insightNames: resolvedNames });
  };

  const handleDetected = (statement: ExtractoDetected) => {
    // The statement is a starting point, never the final truth. Its aggregates
    // prefill the short context step; that step is where a person can correct
    // the values and add the facts a bank statement cannot know.
    updateDraft({
      ...draft,
      income: String(statement.monthlyIncome),
      accountBalance: String(statement.accountBalance ?? 0),
      savingMonthly: String(statement.savingMonthly),
      investmentMonthly: String(statement.investmentMonthly),
      assetsCuasiEfectivo: draft.assetsCuasiEfectivo || '0',
    });
    const filled = ['income', 'accountBalance', 'savingMonthly', 'investmentMonthly'];
    setPrefilled(filled);
    saveDetection({ detected: statement, prefilled: filled, insightNames });
    setStep('context');
  };

  const handleContextSubmit = async () => {
    setSubmitting(true);
    const { data, error } = await saveFields(draftToPayload(draft), accessToken);
    setSubmitting(false);
    if (!data) {
      toast.error(t(`radiografia.onboarding.context.errors.${error ?? 'generic'}`, t('radiografia.errors.generic')));
      return;
    }
    setStageId(data.stage.stageId);
    setBranchId(data.stage.branchId);
    setStep('email');
  };

  const handleEmailVerified = async (token: string, verifiedEmail: string, delivered: boolean, verifiedReportToken: string | null) => {
    setAccessToken(token);
    setEmailVerified(true);
    setEmail(verifiedEmail);
    setReportSent(delivered);
    setReportToken(verifiedReportToken);
    clearDraft();
    setStep('result');
    // Fired regardless of `delivered` — a mail-provider hiccup doesn't undo
    // that the email was confirmed and the result screen is what renders next.
    trackPlausible('radiografia_completada');
    trackPlausible('email_capturado');
  };

  const handleReportResend = async () => {
    const { data, error } = await resendReport(accessToken);
    if (!data?.delivered) {
      toast.error(t(`radiografia.onboarding.result.errors.${error ?? 'generic'}`, t('radiografia.errors.generic')));
      return false;
    }
    setReportSent(true);
    if (data.reportToken) setReportToken(data.reportToken);
    return true;
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="xray-scope size-full bg-background overflow-y-auto">
      {/* Enter-only remount on key change — no AnimatePresence/exit. Its
          mode="wait" here would sometimes never resolve the exit phase,
          permanently freezing the visible step one screen behind the actual
          (correct) state, recoverable only by a full page reload. */}
      <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
        {step === 'upload' && <EnrichmentBlock accessToken={accessToken} detected={detected} onDetectedChange={updateDetected} onDetected={handleDetected} />}
        {step === 'context' && <FinancialContextBlock draft={draft} onChange={updateDraft} onSubmit={handleContextSubmit} onBack={() => setStep('upload')} submitting={submitting} prefilled={prefilled} />}
        {step === 'email' && !emailVerified && <EmailBlock onVerified={handleEmailVerified} names={insightNames} />}
        {step === 'email' && emailVerified && <ResultPlaceholder email={email} stageId={stageId} branchId={branchId} reportToken={reportToken} reportSent={reportSent} onResend={handleReportResend} />}
        {step === 'result' && <ResultPlaceholder email={email} stageId={stageId} branchId={branchId} reportToken={reportToken} reportSent={reportSent} onResend={handleReportResend} />}
      </motion.div>
    </div>
  );
}
