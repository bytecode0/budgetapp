import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOnboardingAnswer, type OnboardingAnswer } from '../hooks/useOnboardingNeeded';

interface NoneAnswerProps {
  answer: OnboardingAnswer;
  /** i18n keys: the question, the button, and the line shown once answered. */
  hintKey: string;
  buttonKey: string;
  answeredKey: string;
}

// "I have no credit cards" / "I have no loans" on the wizard's cards and loans
// steps: a stored answer that marks the step done in "Completa tu
// configuración", with an undo once given.
export function NoneAnswer({ answer, hintKey, buttonKey, answeredKey }: NoneAnswerProps) {
  const { t } = useTranslation();
  const { answered, saving, set } = useOnboardingAnswer(answer);

  const toggle = async (value: boolean) => {
    const result = await set(value);
    if (result.error) toast.error(t('onboarding.answerFailed'));
  };

  if (answered) {
    return (
      <div className="mt-6 bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 flex items-center gap-3 text-sm">
        <Check className="w-4 h-4 text-emerald-600 shrink-0" />
        <p className="flex-1">{t(answeredKey)}</p>
        <button
          onClick={() => toggle(false)}
          disabled={saving}
          className="px-4 py-2 border border-border rounded-xl hover:bg-muted transition-colors text-sm shrink-0 disabled:opacity-50"
        >
          {t('onboarding.undo')}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 text-center space-y-3">
      <p className="text-sm text-muted-foreground">{t(hintKey)}</p>
      <button
        onClick={() => toggle(true)}
        disabled={saving}
        className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm inline-flex items-center gap-2 disabled:opacity-50"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        {t(buttonKey)}
      </button>
    </div>
  );
}
