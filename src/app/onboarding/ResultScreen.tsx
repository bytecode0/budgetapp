import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useMoney } from './useMoney';

interface OnboardingResult {
  monthlyIncome: number; // euros
  committed: number;     // euros
  pctCommitted: number;
  totalOwed: number;     // euros
  hasConsumerDebt: boolean;
  freedomMonths: number | null; // null: no consumer debt, or never paid off
  payoffOrder: { id: string; name: string; monthPaidOff: number }[];
  budgeted: number;      // euros
  leftover: number;      // euros
}

interface ResultScreenProps {
  onDone: () => void;
}

// Step 8. Everything is computed server-side (GET /api/onboarding/result →
// server/lib/onboarding.ts) from the rows the previous steps created; nothing
// is recomputed here.
export function ResultScreen({ onDone }: ResultScreenProps) {
  const { t } = useTranslation();
  const { fmt, locale } = useMoney();
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/onboarding/result', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load result');
        const { data } = await res.json();
        setResult(data);
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  if (!result && !failed) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const freedomDate = result?.freedomMonths != null
    ? new Date(new Date().getFullYear(), new Date().getMonth() + result.freedomMonths, 1)
    : null;

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <h1 className="text-4xl tracking-tight">{t('onboarding.result.title')}</h1>
        <p className="text-muted-foreground">{t('onboarding.result.subtitle')}</p>
      </motion.div>

      {failed || !result ? (
        <div className="bg-red-50 dark:bg-red-950/20 border-2 border-red-200 dark:border-red-800 rounded-2xl p-5 text-sm">
          {t('onboarding.result.loadFailed')}
        </div>
      ) : (
        <>
          {result.monthlyIncome > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl p-8 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
              <div className="relative z-10 space-y-2">
                <p className="text-sm opacity-75">{t('onboarding.result.committedFuture')}</p>
                <p className="text-5xl font-display">
                  {t('onboarding.result.pct', { value: result.pctCommitted.toLocaleString(locale, { maximumFractionDigits: 1 }) })}
                </p>
                <p className="text-sm opacity-75">
                  {t('onboarding.result.committedOf', { committed: fmt(result.committed), income: fmt(result.monthlyIncome) })}
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 text-sm">
              {t('onboarding.result.missingIncome')}
            </div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
          >
            <div className="bg-card border border-border rounded-2xl p-6">
              <p className="text-xs text-muted-foreground">{t('onboarding.result.totalOwed')}</p>
              <p className="text-2xl font-display">{fmt(result.totalOwed)}</p>
            </div>
            <div className="bg-card border border-border rounded-2xl p-6">
              <p className="text-xs text-muted-foreground">{t('onboarding.result.freedomDate')}</p>
              {!result.hasConsumerDebt ? (
                <p className="text-sm mt-1">{t('onboarding.result.freedomNone')}</p>
              ) : freedomDate ? (
                <p className="text-2xl font-display capitalize">{freedomDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</p>
              ) : (
                <p className="text-sm mt-1 text-red-500">{t('onboarding.result.freedomNever')}</p>
              )}
            </div>
            <div className="bg-card border border-border rounded-2xl p-6">
              <p className="text-xs text-muted-foreground">{t('onboarding.result.leftover')}</p>
              <p className={`text-2xl font-display ${result.leftover < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(result.leftover)}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('onboarding.result.leftoverDesc')}</p>
            </div>
          </motion.div>

          {result.leftover < 0 && (
            <div className="bg-red-50 dark:bg-red-950/20 border-2 border-red-200 dark:border-red-800 rounded-2xl p-5 text-sm">
              {t('onboarding.result.leftoverNegative')}
            </div>
          )}

          {result.payoffOrder.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
              className="bg-card border border-border rounded-2xl p-6 space-y-2"
            >
              <p className="font-display text-lg">{t('onboarding.result.attackOrder')}</p>
              {result.payoffOrder.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <span>{i + 1}. {d.name || t('onboarding.result.unnamedDebt')}</span>
                  <span className="text-muted-foreground">{t('onboarding.result.monthN', { n: d.monthPaidOff })}</span>
                </div>
              ))}
            </motion.div>
          )}
        </>
      )}

      <button
        onClick={onDone}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
      >
        {t('onboarding.result.goToDashboard')}
      </button>
    </div>
  );
}
