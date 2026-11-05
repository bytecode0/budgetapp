import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, PiggyBank, ShieldCheck, Unlock, TrendingUp, type LucideIcon } from 'lucide-react';
import { ONBOARDING_GOALS, setOnboardingGoal, type OnboardingGoal } from '../hooks/useOnboardingNeeded';

const GOAL_ICON: Record<OnboardingGoal, LucideIcon> = {
  steady: PiggyBank,
  emergency: ShieldCheck,
  debt: Unlock,
  invest: TrendingUp,
};

interface GoalStepProps {
  goal: OnboardingGoal | null;
  onChange: (goal: OnboardingGoal | null) => void;
}

// The opening question (LPBETA-07): what the user wants to achieve. Saved as
// soon as it's picked; only "Salir de deudas" changes the wizard (the cards
// and loans steps keep their full weight). Picking the chosen one again clears it.
export function GoalStep({ goal, onChange }: GoalStepProps) {
  const { t } = useTranslation();

  const pick = async (value: OnboardingGoal) => {
    const next = goal === value ? null : value;
    const previous = goal;
    onChange(next);
    const result = await setOnboardingGoal(next);
    if (result.error) { onChange(previous); toast.error(t('onboarding.goal.saveFailed')); }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" role="radiogroup">
      {ONBOARDING_GOALS.map(value => {
        const Icon = GOAL_ICON[value];
        const selected = goal === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => pick(value)}
            className={`text-left bg-card border rounded-3xl p-6 flex items-start gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected ? 'border-pool bg-pool-soft' : 'border-border hover:bg-muted'
            }`}
          >
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${selected ? 'bg-pool text-on-pool' : 'bg-muted text-pool'}`}>
              {selected ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-lg font-semibold">{t(`onboarding.goal.options.${value}.title`)}</p>
              <p className="text-sm text-muted-foreground">{t(`onboarding.goal.options.${value}.desc`)}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
