import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Sparkles, ArrowRight, Wallet, PiggyBank, LineChart } from 'lucide-react';

interface WelcomeStepProps {
  onStart: () => void;
}

export function WelcomeStep({ onStart }: WelcomeStepProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center py-4">
      {/* Left column: copy */}
      <div className="flex flex-col gap-6 max-w-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 text-secondary text-sm font-medium w-fit">
          <Sparkles className="w-3.5 h-3.5" /> {t('onboarding.welcome.badge')}
        </div>

        <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight leading-[1.1]">
          {t('onboarding.welcome.titlePrefix')} <span className="text-secondary">{t('onboarding.welcome.titleHighlight')}</span>.
        </h1>

        <p className="text-lg text-muted-foreground leading-relaxed">{t('onboarding.welcome.subtitle')}</p>

        <button
          onClick={onStart}
          className="mt-2 bg-foreground text-background font-medium px-8 py-4 rounded-xl hover:bg-foreground/90 transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 text-lg w-fit"
        >
          {t('onboarding.welcome.start')} <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Right column: feature cards */}
      <div className="relative w-full flex items-center justify-center lg:justify-end">
        <div className="absolute inset-0 bg-gradient-to-tr from-secondary/5 to-secondary/10 rounded-[3rem] -z-10 transform rotate-3 scale-105" />
        <div className="flex flex-col gap-4 w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="bg-card p-6 rounded-2xl shadow-xl border border-border flex items-start gap-4"
          >
            <div className="w-12 h-12 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">{t('onboarding.welcome.card1Title')}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t('onboarding.welcome.card1Desc')}</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-card p-6 rounded-2xl shadow-xl border border-border flex items-start gap-4 ml-0 sm:ml-8"
          >
            <div className="w-12 h-12 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center shrink-0">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">{t('onboarding.welcome.card2Title')}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{t('onboarding.welcome.card2Desc')}</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="bg-gray-900 dark:bg-black text-white p-6 rounded-2xl shadow-2xl border border-gray-800 flex items-start gap-4"
          >
            <div className="w-12 h-12 rounded-xl bg-gray-800 text-secondary flex items-center justify-center shrink-0">
              <LineChart className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">{t('onboarding.welcome.card3Title')}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{t('onboarding.welcome.card3Desc')}</p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
