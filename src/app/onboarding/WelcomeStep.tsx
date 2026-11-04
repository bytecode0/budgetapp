import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Sun, ArrowRight, Wallet, PiggyBank, ListChecks } from 'lucide-react';

interface WelcomeStepProps {
  onStart: () => void;
}

export function WelcomeStep({ onStart }: WelcomeStepProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center py-4">
      {/* Left column: copy */}
      <div className="flex flex-col gap-6 max-w-xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pool-soft text-pool text-sm font-medium w-fit">
          <Sun className="w-3.5 h-3.5" /> {t('onboarding.welcome.badge')}
        </div>

        <h1 className="text-4xl sm:text-5xl font-display font-bold tracking-tight leading-[1.1]">
          {t('onboarding.welcome.titlePrefix')} <span className="text-pool">{t('onboarding.welcome.titleHighlight')}</span>.
        </h1>

        <p className="text-lg text-muted-foreground leading-relaxed">{t('onboarding.welcome.subtitle')}</p>

        <button
          onClick={onStart}
          className="mt-2 bg-primary text-primary-foreground font-medium px-8 py-4 rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 text-lg w-fit"
        >
          {t('onboarding.welcome.start')} <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* Right column: what the next minutes cover — in, out, kept */}
      <div className="w-full flex items-center justify-center lg:justify-end">
        <div className="flex flex-col gap-4 w-full max-w-md">
          {[
            { Icon: Wallet, title: 'card1Title', desc: 'card1Desc' },
            { Icon: ListChecks, title: 'card2Title', desc: 'card2Desc' },
            { Icon: PiggyBank, title: 'card3Title', desc: 'card3Desc' },
          ].map(({ Icon, title, desc }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * (i + 1), duration: 0.18 }}
              className="bg-card p-6 rounded-3xl border border-border flex items-start gap-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-pool-soft text-pool flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">{t(`onboarding.welcome.${title}`)}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t(`onboarding.welcome.${desc}`)}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
