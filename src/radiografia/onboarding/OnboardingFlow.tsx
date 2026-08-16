import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import '../xray-theme.css';
import { useOnboardingState, loadDraft, saveDraft, clearDraft } from './useOnboardingState';
import { Block1Form, emptyBlock1Draft, draftToPayload, type Block1Draft } from './Block1Form';
import { EmailBlock } from './EmailBlock';
import { EnrichmentBlock } from './EnrichmentBlock';
import { ResultPlaceholder } from './ResultPlaceholder';
import { saveFields } from './onboardingApi';

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export function OnboardingFlow() {
  const { i18n } = useTranslation();
  useEffect(() => { if (i18n.language !== 'es') i18n.changeLanguage('es'); }, [i18n]);

  const { step, setStep, accessToken, setAccessToken, emailVerified, setEmailVerified, email, setEmail, stageId, setStageId, branchId, setBranchId, loading } = useOnboardingState();
  const [draft, setDraft] = useState<Block1Draft>(() => loadDraft() ?? emptyBlock1Draft());
  const [submitting, setSubmitting] = useState(false);

  const updateDraft = (next: Block1Draft) => { setDraft(next); saveDraft(next); };

  const handleBlock1Submit = () => {
    // Pre-email there's nothing legitimate to persist server-side (plan
    // §2.5 point 1) — the draft already lives in sessionStorage via
    // updateDraft, so advancing to the email block is the only action here.
    setStep('block2_email');
  };

  const handleEmailVerified = async (token: string, verifiedEmail: string) => {
    setAccessToken(token);
    setEmailVerified(true);
    setEmail(verifiedEmail);
    setSubmitting(true);
    const { data } = await saveFields(draftToPayload(draft), token);
    if (data) {
      setStageId(data.stage.stageId);
      setBranchId(data.stage.branchId);
    }
    setSubmitting(false);
    clearDraft();
    setStep('block3_enrichment');
  };

  const handleEnrichmentDone = (newStageId: string | null, newBranchId: string | null) => {
    setStageId(newStageId);
    setBranchId(newBranchId);
    setStep('result');
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="xray-scope size-full bg-background overflow-y-auto">
      {/* Enter-only remount on key change — no AnimatePresence/exit. Its
          mode="wait" here would sometimes never resolve the exit phase,
          permanently freezing the visible step one screen behind the actual
          (correct) state, recoverable only by a full page reload. */}
      <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
        {step === 'block1' && (
          <Block1Form draft={draft} onChange={updateDraft} onSubmit={handleBlock1Submit} submitting={submitting} />
        )}
        {step === 'block2_email' && !emailVerified && <EmailBlock onVerified={handleEmailVerified} />}
        {step === 'block2_email' && emailVerified && (
          <EnrichmentBlock accessToken={accessToken} onDone={handleEnrichmentDone} onSkip={() => setStep('result')} />
        )}
        {step === 'block3_enrichment' && (
          <EnrichmentBlock accessToken={accessToken} onDone={handleEnrichmentDone} onSkip={() => setStep('result')} />
        )}
        {step === 'result' && <ResultPlaceholder email={email} stageId={stageId} branchId={branchId} />}
      </motion.div>
    </div>
  );
}
