import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Circle, X } from 'lucide-react';
import type { OnboardingStep } from '../hooks/useOnboardingNeeded';

const DISMISS_KEY = 'setupChecklistDismissed';

// The dismissal is per browser and remembers WHICH gaps were dismissed: if
// something else goes missing later, the card comes back. Storage can be
// unavailable (private mode, blocked site data) — then it just shows.
function readDismissed(): string | null {
  try { return window.localStorage.getItem(DISMISS_KEY); } catch { return null; }
}
function writeDismissed(value: string) {
  try { window.localStorage.setItem(DISMISS_KEY, value); } catch { /* not persisted */ }
}

interface SetupChecklistProps {
  /** Missing setup steps, from GET /api/onboarding/status (derived, never stored). */
  missing: OnboardingStep[];
  /** Reopens the onboarding wizard at that step. */
  onResume: (step: OnboardingStep) => void;
}

// "Completa tu configuración" on the dashboard, for a user who left the
// onboarding half-way: one row per missing piece, each reopening its step.
export function SetupChecklist({ missing, onResume }: SetupChecklistProps) {
  const { t } = useTranslation();
  const missingKey = [...missing].sort().join(',');
  const [dismissed, setDismissed] = useState(readDismissed);

  if (missing.length === 0 || dismissed === missingKey) return null;

  const dismiss = () => { writeDismissed(missingKey); setDismissed(missingKey); };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
      className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg">{t('onboarding.setup.title')}</p>
          <p className="text-sm text-muted-foreground">{t('onboarding.setup.subtitle')}</p>
        </div>
        <button onClick={dismiss} className="p-2 rounded-lg hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors shrink-0" title={t('onboarding.setup.dismiss')}>
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
      <div className="space-y-1">
        {missing.map(step => (
          <button
            key={step}
            onClick={() => onResume(step)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-left"
          >
            <span className="flex items-center gap-3 text-sm">
              <Circle className="w-4 h-4 text-amber-600 shrink-0" />
              {t(`onboarding.setup.items.${step}`)}
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
              {t('onboarding.setup.complete')} <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}
