import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Circle, X } from 'lucide-react';
import { toast } from 'sonner';
import { setOnboardingAnswer, type OnboardingAnswer, type OnboardingStep } from '../hooks/useOnboardingNeeded';

// Steps the user can close by saying they have none (PATCH /api/onboarding/answers).
const NONE_ANSWER: Partial<Record<OnboardingStep, OnboardingAnswer>> = { cards: 'noCards', loans: 'noLoans' };

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
  /** Re-reads the onboarding status after an answer changes. */
  onChanged: () => void;
}

// "Completa tu configuración" on the dashboard, for a user who left the
// onboarding half-way: one row per missing piece, each reopening its step.
export function SetupChecklist({ missing, onResume, onChanged }: SetupChecklistProps) {
  const { t } = useTranslation();
  const missingKey = [...missing].sort().join(',');
  const [dismissed, setDismissed] = useState(readDismissed);

  if (missing.length === 0 || dismissed === missingKey) return null;

  const dismiss = () => { writeDismissed(missingKey); setDismissed(missingKey); };

  const answerNone = async (step: OnboardingStep, answer: OnboardingAnswer) => {
    const result = await setOnboardingAnswer(answer, true);
    if (result.error) { toast.error(t('onboarding.answerFailed')); return; }
    onChanged();
    toast.success(t(`onboarding.setup.answered.${step}`), {
      action: {
        label: t('onboarding.undo'),
        onClick: async () => {
          const undo = await setOnboardingAnswer(answer, false);
          if (undo.error) toast.error(t('onboarding.answerFailed'));
          onChanged();
        },
      },
    });
  };

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
        {missing.map(step => {
          const answer = NONE_ANSWER[step];
          return (
            <div key={step} className="flex items-center gap-1">
              <button
                onClick={() => onResume(step)}
                className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors text-left"
              >
                <span className="flex items-center gap-3 text-sm">
                  <Circle className="w-4 h-4 text-amber-600 shrink-0" />
                  {t(`onboarding.setup.items.${step}`)}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  {t('onboarding.setup.complete')} <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
              {answer && (
                <button
                  onClick={() => answerNone(step, answer)}
                  className="px-3 py-2 border border-border rounded-xl hover:bg-muted transition-colors text-xs shrink-0"
                >
                  {t('onboarding.setup.sayNo')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
