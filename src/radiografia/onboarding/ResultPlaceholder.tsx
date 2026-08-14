import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import { XRayMark } from '../XRayMark';

// The real teaser (score + etapa + arquetipo, plan F6) needs the stage
// engine (F5), which is blocked on product decisions Q1–Q2 (the 5 stage
// criteria, and confirming 10/50/20/20-as-inputs / stages-as-spine /
// arquetipos-as-presentation). Showing a fabricated stage here would violate
// the plan's own rule — "nunca inventar una etapa" — so this is an honest
// "recibido, en proceso" screen until F5 lands, not a stand-in result.
interface Props {
  email: string | null;
}

export function ResultPlaceholder({ email }: Props) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-50 dark:bg-emerald-950/20 rounded-2xl mx-auto">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <XRayMark className="w-7 h-7 mx-auto" />
        <h1 className="text-2xl font-display tracking-tight">{t('radiografia.onboarding.result.title')}</h1>
        <p className="text-muted-foreground">
          {email ? t('radiografia.onboarding.result.subtitleWithEmail', { email }) : t('radiografia.onboarding.result.subtitle')}
        </p>
      </motion.div>
    </div>
  );
}
