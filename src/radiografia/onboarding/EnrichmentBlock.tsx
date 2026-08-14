import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { XRayMark } from '../XRayMark';

// Placeholder for Bloque 3 (plan F10/F11 — expense breakdown + optional
// statement upload, both post-launch/flagged). Skippable by design: the
// brief is explicit that the extracto is "siempre opcional, nunca puerta de
// entrada" — Bloque 1 alone is enough to reach a result.
interface Props {
  onSkip: () => void;
}

export function EnrichmentBlock({ onSkip }: Props) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <XRayMark className="w-8 h-8 mx-auto" />
        <h1 className="text-2xl font-display tracking-tight">{t('radiografia.onboarding.enrichment.title')}</h1>
        <p className="text-muted-foreground">{t('radiografia.onboarding.enrichment.subtitle')}</p>
        <button
          onClick={onSkip}
          className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display"
        >
          {t('radiografia.onboarding.enrichment.skip')}
        </button>
      </motion.div>
    </div>
  );
}
