import { motion } from 'motion/react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RemansoMark } from '../shared/RemansoMark';

interface LandingProps {
  onSignup: () => void;
  onLogin: () => void;
}

// The public welcome page (LPBETA-11): what a friend sees when they open the
// link without a session. It has to explain Remanso on its own, in a minute.
// The steps follow docs/vision-y-plan-beta.md; the app does not advise on
// investments, and the copy says so.
const STEPS = ['see', 'order', 'debts', 'save', 'invest'] as const;

export function Landing({ onSignup, onLogin }: LandingProps) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="max-w-3xl mx-auto px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RemansoMark className="w-8 h-8" />
          <span className="font-display text-lg text-primary">remanso</span>
        </div>
        <button onClick={onLogin} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          {t('auth.landing.login')}
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-8 pt-8 pb-12 space-y-10">
        <motion.section
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-4"
        >
          <h1 className="text-4xl tracking-tight font-display">{t('auth.landing.title')}</h1>
          <p className="text-lg text-muted-foreground max-w-xl">{t('auth.landing.lead')}</p>
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={onSignup}
              className="sm:w-auto w-full px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors"
            >
              {t('auth.landing.signup')}
            </button>
            <button
              onClick={onLogin}
              className="sm:w-auto w-full px-6 py-3 border border-border rounded-xl hover:bg-muted transition-colors"
            >
              {t('auth.landing.login')}
            </button>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="bg-card border border-border rounded-3xl p-6 space-y-5"
        >
          <h2 className="text-2xl font-display">{t('auth.landing.stepsTitle')}</h2>
          <ol className="space-y-4">
            {STEPS.map((step, i) => (
              <li key={step} className="flex gap-4">
                <span className="w-8 h-8 shrink-0 rounded-full bg-pool-soft text-pool font-display flex items-center justify-center tabular-nums">
                  {i + 1}
                </span>
                <div className="space-y-0.5">
                  <p className="text-lg font-semibold">{t(`auth.landing.steps.${step}.title`)}</p>
                  <p className="text-sm text-muted-foreground">{t(`auth.landing.steps.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="bg-card border border-border rounded-3xl p-6 flex gap-4"
        >
          <ShieldCheck className="w-6 h-6 text-reed shrink-0 mt-0.5" aria-hidden />
          <div className="space-y-2">
            <p className="text-lg font-semibold">{t('auth.landing.privacyTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('auth.landing.privacyBody')}</p>
            <a href="/privacy" className="inline-block text-sm text-primary hover:underline">
              {t('auth.landing.privacyLink')}
            </a>
          </div>
        </motion.section>
      </main>

      <footer className="max-w-3xl mx-auto px-4 sm:px-8 pb-8 flex gap-4 text-xs text-muted-foreground">
        <a href="/privacy" className="hover:text-foreground transition-colors">{t('auth.landing.privacy')}</a>
        <a href="/terms" className="hover:text-foreground transition-colors">{t('auth.landing.terms')}</a>
      </footer>
    </div>
  );
}
