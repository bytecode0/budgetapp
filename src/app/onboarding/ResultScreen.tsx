import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Loader2, Sprout } from 'lucide-react';
import { useMoney } from './useMoney';
import { EmergencyFundOffer } from './EmergencyFundOffer';
import { PayYourselfFirstPicker } from './PayYourselfFirstPicker';

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
  monthlyExpenses: number;        // euros
  emergencyFundSuggested: number; // euros
  savedSoFar: number;             // euros
  hasEmergencyPlan: boolean;
  payYourselfFirstBps: number | null;
}

interface ResultScreenProps {
  onDone: () => void;
}

// The wizard's last step (LPBETA-07). The headline is what the user could
// save ("Ganas X. Cada mes podrías ahorrar Y si…"); the futuro comprometido is
// one figure among others and the debt payoff shows only when there is debt.
// Then the first goals, always offered: an emergency fund and "Págate a ti
// primero". Every figure is computed server-side (GET /api/onboarding/result →
// server/lib/onboarding.ts) from the rows the previous steps created.
export function ResultScreen({ onDone }: ResultScreenProps) {
  const { t } = useTranslation();
  const { fmt, locale } = useMoney();
  const [result, setResult] = useState<OnboardingResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [payFirstBps, setPayFirstBps] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/onboarding/result', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to load result');
        const { data } = await res.json();
        setResult(data);
        setPayFirstBps(data.payYourselfFirstBps ?? null);
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

  const doneButton = (
    <button
      onClick={onDone}
      className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
    >
      {t('onboarding.result.goToDashboard')}
    </button>
  );

  if (failed || !result) {
    return (
      <div className="space-y-6">
        <h1 className="text-4xl tracking-tight font-display">{t('onboarding.result.title')}</h1>
        <div className="bg-alert-soft text-alert rounded-2xl p-5 text-sm">{t('onboarding.result.loadFailed')}</div>
        {doneButton}
      </div>
    );
  }

  const income = result.monthlyIncome;

  return (
    <div className="space-y-6">
      <motion.h1 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="text-4xl tracking-tight font-display">
        {t('onboarding.result.title')}
      </motion.h1>

      {/* The one answer: what you could save each month. */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.18 }}>
        {income <= 0 ? (
          <div className="bg-sun-soft text-sun-ink rounded-3xl p-6 text-sm">{t('onboarding.result.noIncome')}</div>
        ) : result.leftover > 0 ? (
          <div className="bg-pool text-on-pool rounded-3xl p-8 space-y-2">
            <p className="text-sm">{t('onboarding.result.earn', { income: fmt(income) })}</p>
            <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{t('onboarding.result.couldSaveLabel')}</p>
            <p className="text-5xl font-display tabular-nums">{fmt(result.leftover)}</p>
            <p className="text-sm">{t('onboarding.result.couldSaveIf')}</p>
          </div>
        ) : (
          <div className="bg-sun-soft text-sun-ink rounded-3xl p-6 text-sm">
            {result.leftover < 0
              ? t('onboarding.result.overspent', { income: fmt(income), amount: fmt(-result.leftover) })
              : t('onboarding.result.noRoom', { income: fmt(income) })}
          </div>
        )}
      </motion.div>

      {/* Other figures: the committed future is one of them, not the headline. */}
      {income > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.18 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div className="bg-card border border-border rounded-3xl p-6">
            <p className="text-xs text-muted-foreground">{t('onboarding.result.committedFutureLabel')}</p>
            <p className="text-2xl font-display tabular-nums">
              {t('onboarding.result.pct', { value: result.pctCommitted.toLocaleString(locale, { maximumFractionDigits: 1 }) })}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {result.committed > 0
                ? t('onboarding.result.committedOf', { committed: fmt(result.committed), income: fmt(income) })
                : t('onboarding.result.committedNone')}
            </p>
          </div>
        </motion.div>
      )}

      {result.totalOwed > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.18 }}
          className="bg-card border border-border rounded-3xl p-6 space-y-4"
        >
          <p className="text-lg font-semibold">{t('onboarding.result.debtTitle')}</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{t('onboarding.result.totalOwed')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(result.totalOwed)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t('onboarding.result.freedomDate')}</p>
              {!result.hasConsumerDebt ? (
                <p className="text-sm mt-1">{t('onboarding.result.freedomNone')}</p>
              ) : freedomDate ? (
                <p className="text-2xl font-display capitalize">{freedomDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</p>
              ) : (
                <p className="text-sm mt-1 text-sun-ink">{t('onboarding.result.freedomNever')}</p>
              )}
            </div>
          </div>
          {result.payoffOrder.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('onboarding.result.attackOrder')}</p>
              {result.payoffOrder.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <span>{i + 1}. {d.name || t('onboarding.result.unnamedDebt')}</span>
                  <span className="text-muted-foreground">{t('onboarding.result.monthN', { n: d.monthPaidOff })}</span>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* First goals: always offered (LPBETA-07). */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.18 }} className="space-y-4">
        <div>
          <h2 className="text-2xl font-display">{t('onboarding.result.firstGoalsTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('onboarding.result.firstGoalsSubtitle')}</p>
        </div>

        <EmergencyFundOffer
          suggested={result.emergencyFundSuggested}
          monthlyExpenses={result.monthlyExpenses}
          savedSoFar={result.savedSoFar}
          hasEmergencyPlan={result.hasEmergencyPlan}
        />

        <div className="bg-card border border-border rounded-3xl p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-2xl bg-pool-soft text-pool flex items-center justify-center shrink-0">
              <Sprout className="w-5 h-5" />
            </div>
            <div>
              <p className="text-lg font-semibold">{t('onboarding.result.payFirst.title')}</p>
              <p className="text-sm text-muted-foreground">{t('onboarding.result.payFirst.desc')}</p>
            </div>
          </div>
          <PayYourselfFirstPicker valueBps={payFirstBps} income={income} leftover={result.leftover} onSaved={setPayFirstBps} />
        </div>
      </motion.div>

      {doneButton}
    </div>
  );
}
