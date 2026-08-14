import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { CheckCircle2 } from 'lucide-react';
import { XRayMark } from '../XRayMark';

// F6 (partial): shows the real etapa (plan §3, motor de etapas) — the one
// piece of the on-screen teaser that a manual-only Block 1 submission can
// legitimately produce. Score and arquetipo are NOT shown here: both come
// from server/lib/xray/{healthIndex,archetype}.ts, which require multi-month
// transaction history (e.g. archetype's "faithful giving" check needs
// several distinct months of amounts) that a single manual snapshot can't
// supply. Fabricating either from a snapshot would violate the same rule
// that already governs stage classification — never invent what the data
// can't support. That gap is a separate open question, not resolved here.
interface Props {
  email: string | null;
  stageId: string | null;
  branchId: string | null;
}

export function ResultPlaceholder({ email, stageId, branchId }: Props) {
  const { t } = useTranslation();
  const stageKey = branchId ?? stageId;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-50 dark:bg-emerald-950/20 rounded-2xl mx-auto">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <XRayMark className="w-7 h-7 mx-auto" />

        {stageKey ? (
          <>
            <p className="text-xs text-primary uppercase" style={{ letterSpacing: '0.1em' }}>
              {t('radiografia.onboarding.result.stageBadge')}
            </p>
            <h1 className="text-3xl font-display tracking-tight">{t(`radiografia.methodStage.${stageKey}.name`)}</h1>
            <p className="text-muted-foreground">{t(`radiografia.methodStage.${stageKey}.description`)}</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-display tracking-tight">{t('radiografia.onboarding.result.title')}</h1>
            <p className="text-muted-foreground">
              {email ? t('radiografia.onboarding.result.subtitleWithEmail', { email }) : t('radiografia.onboarding.result.subtitle')}
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
