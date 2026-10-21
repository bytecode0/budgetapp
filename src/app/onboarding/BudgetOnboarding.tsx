import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Target } from 'lucide-react';
import type { OnboardingStep } from '../hooks/useOnboardingNeeded';
import { WelcomeStep } from './WelcomeStep';
import { IncomeStep } from './IncomeStep';
import { SavingsStep } from './SavingsStep';
import { BankStep } from './BankStep';
import { CardsStep } from './CardsStep';
import { LoansStep } from './LoansStep';
import { BudgetLinesStep } from './BudgetLinesStep';
import { ResultScreen } from './ResultScreen';

// Steps between the welcome and the result, with the header's back/continue.
const WIZARD_STEPS: OnboardingStep[] = ['income', 'savings', 'bank', 'cards', 'loans', 'fixed', 'flexible'];

const STEP_META: Partial<Record<OnboardingStep, { titleKey: string; subtitleKey: string }>> = {
  income: { titleKey: 'onboarding.income.title', subtitleKey: 'onboarding.income.subtitle' },
  savings: { titleKey: 'onboarding.savings.title', subtitleKey: 'onboarding.savings.subtitle' },
  bank: { titleKey: 'onboarding.bank.title', subtitleKey: 'onboarding.bank.subtitle' },
  cards: { titleKey: 'onboarding.cards.title', subtitleKey: 'onboarding.cards.subtitle' },
  loans: { titleKey: 'onboarding.loans.title', subtitleKey: 'onboarding.loans.subtitle' },
  fixed: { titleKey: 'onboarding.lines.fixed.title', subtitleKey: 'onboarding.lines.fixed.subtitle' },
  flexible: { titleKey: 'onboarding.lines.flexible.title', subtitleKey: 'onboarding.lines.flexible.subtitle' },
};

interface BudgetOnboardingProps {
  /** Where to open — the dashboard's "Completa tu configuración" reopens a given step. */
  initialStep?: OnboardingStep;
  onDone: () => void;
}

// The onboarding wizard (docs/plan-deudas-y-onboarding.md, epic 3). Every step
// writes real rows through the app's own hooks as the user fills it in —
// nothing is staged and submitted at the end — so "Continuar" only advances
// (skipping a step is just continuing without filling it) and "Atrás" only
// goes back: neither deletes anything.
export function BudgetOnboarding({ initialStep = 'welcome', onDone }: BudgetOnboardingProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>(initialStep);

  const currentIdx = WIZARD_STEPS.indexOf(step);
  const inWizard = currentIdx >= 0;
  const goNext = () => setStep(WIZARD_STEPS[currentIdx + 1] ?? 'result');
  const goBack = () => setStep(currentIdx <= 0 ? 'welcome' : WIZARD_STEPS[currentIdx - 1]);

  const meta = STEP_META[step];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="w-full bg-card border-b border-border py-4 px-6 sm:px-8 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-primary to-secondary rounded-lg flex items-center justify-center">
            <Target className="w-5 h-5 text-white" />
          </div>
          <span className="font-display text-lg text-foreground">LifePlan</span>
        </div>
        {inWizard && (
          <div className="flex items-center gap-2">
            <button
              onClick={goBack}
              className="text-sm font-medium text-muted-foreground hover:text-foreground px-3 py-2 rounded-full transition-colors flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> {t('onboarding.back')}
            </button>
            <button
              onClick={goNext}
              className="text-sm font-medium bg-foreground text-background px-5 py-2 rounded-full hover:bg-foreground/90 transition-colors"
            >
              {t('onboarding.continue')}
            </button>
          </div>
        )}
      </header>

      {inWizard && (
        <div className="w-full h-1.5 bg-muted">
          <div
            className="h-1.5 bg-secondary transition-all duration-200"
            style={{ width: `${((currentIdx + 1) / WIZARD_STEPS.length) * 100}%` }}
          />
        </div>
      )}

      <main className="flex-1 flex flex-col items-center p-4 sm:p-8">
        <div className={`w-full ${step === 'welcome' ? 'max-w-5xl' : 'max-w-2xl'} mx-auto ${inWizard ? 'mt-4 sm:mt-8' : ''}`}>
          {inWizard && meta && (
            <div className="text-center mb-8">
              <span className="text-secondary font-semibold text-sm tracking-wider uppercase mb-3 block">
                {t('onboarding.stepOf', { current: currentIdx + 1, total: WIZARD_STEPS.length })}
              </span>
              <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight mb-3">{t(meta.titleKey)}</h1>
              <p className="text-base sm:text-lg text-muted-foreground max-w-lg mx-auto">{t(meta.subtitleKey)}</p>
            </div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {step === 'welcome' && <WelcomeStep onStart={() => setStep('income')} />}
              {step === 'income' && <IncomeStep />}
              {step === 'savings' && <SavingsStep />}
              {step === 'bank' && <BankStep />}
              {step === 'cards' && <CardsStep />}
              {step === 'loans' && <LoansStep />}
              {step === 'fixed' && <BudgetLinesStep type="fixed" />}
              {step === 'flexible' && <BudgetLinesStep type="flexible" />}
              {step === 'result' && <ResultScreen onDone={onDone} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
