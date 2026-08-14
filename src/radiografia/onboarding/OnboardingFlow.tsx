import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
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

  const { step, setStep, accessToken, setAccessToken, emailVerified, setEmailVerified, email, setEmail, loading } = useOnboardingState();
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
    await saveFields(draftToPayload(draft), token);
    setSubmitting(false);
    clearDraft();
    setStep('block3_enrichment');
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="xray-scope size-full bg-background overflow-y-auto">
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          {step === 'block1' && (
            <Block1Form draft={draft} onChange={updateDraft} onSubmit={handleBlock1Submit} submitting={submitting} />
          )}
          {step === 'block2_email' && !emailVerified && <EmailBlock onVerified={handleEmailVerified} />}
          {step === 'block2_email' && emailVerified && <EnrichmentBlock onSkip={() => setStep('result')} />}
          {step === 'block3_enrichment' && <EnrichmentBlock onSkip={() => setStep('result')} />}
          {step === 'result' && <ResultPlaceholder email={email} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
