import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Target } from 'lucide-react';
import { WelcomeStep } from './WelcomeStep';
import { IncomeStep } from './IncomeStep';
import { SavingsStep } from './SavingsStep';
import { DebtsStep } from './DebtsStep';
import { BudgetStep } from './BudgetStep';
import { ResultScreen } from './ResultScreen';

type OnboardingStep = 'welcome' | 'income' | 'savings' | 'debts' | 'budget' | 'result';

const WIZARD_STEPS: OnboardingStep[] = ['income', 'savings', 'debts', 'budget'];

const STEP_META: Record<string, { titleKey: string; subtitleKey: string }> = {
  income: { titleKey: 'onboarding.income.title', subtitleKey: 'onboarding.income.subtitle' },
  savings: { titleKey: 'onboarding.savings.title', subtitleKey: 'onboarding.savings.subtitle' },
  debts: { titleKey: 'onboarding.debts.title', subtitleKey: 'onboarding.debts.subtitle' },
  budget: { titleKey: 'onboarding.budget.title', subtitleKey: 'onboarding.budget.subtitle' },
};

interface BudgetOnboardingProps {
  onDone: () => void;
}

// The onboarding wizard shown after signup whenever the user has nothing
// configured yet (income, debts, budget) — see useOnboardingNeeded and
// server/routes/onboarding.ts. Reuses the app's real hooks (useIncome,
// useAccounts, useDebts, useAllocations) at every step: nothing here is a
// staging area that gets submitted at the end — each step writes real rows,
// so the header's "Siguiente" only ever needs to advance the step index.
export function BudgetOnboarding({ onDone }: BudgetOnboardingProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<OnboardingStep>('welcome');

  const currentIdx = WIZARD_STEPS.indexOf(step);
  const inWizard = currentIdx >= 0;
  const goTo = (s: OnboardingStep) => setStep(s);
  const goNext = () => {
    const next = WIZARD_STEPS[currentIdx + 1];
    setStep(next ?? 'result');
  };
  const goBack = () => {
    if (currentIdx <= 0) { setStep('welcome'); return; }
    setStep(WIZARD_STEPS[currentIdx - 1]);
  };

  const meta = inWizard ? STEP_META[step] : null;

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
            className="h-1.5 bg-secondary transition-all duration-300"
            style={{ width: `${((currentIdx + 1) / WIZARD_STEPS.length) * 100}%` }}
          />
        </div>
      )}

      <main className="flex-1 flex flex-col items-center p-4 sm:p-8">
        <div className={`w-full ${step === 'welcome' ? 'max-w-5xl' : 'max-w-2xl'} mx-auto ${inWizard ? 'mt-4 sm:mt-8' : ''}`}>
          {meta && (
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
              {step === 'welcome' && <WelcomeStep onStart={() => goTo('income')} />}
              {step === 'income' && <IncomeStep />}
              {step === 'savings' && <SavingsStep />}
              {step === 'debts' && <DebtsStep onSkip={goNext} />}
              {step === 'budget' && <BudgetStep />}
              {step === 'result' && <ResultScreen onDone={onDone} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
