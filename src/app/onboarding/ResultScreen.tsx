import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Loader2, PartyPopper } from 'lucide-react';
import { useDebts } from '../hooks/useDebts';
import { useAllocations } from '../hooks/useAllocations';

interface ResultScreenProps {
  onDone: () => void;
}

// Estado A/B, "futuro comprometido" and "fecha de libertad" (Método Ruta R4/R7)
// are all read from existing backend logic (debtTimeline.pctCommitted,
// debts/payoff?scope=consumer's snowball simulation) — nothing here is
// recomputed client-side.
export function ResultScreen({ onDone }: ResultScreenProps) {
  const { t } = useTranslation();
  const { debts, loading: debtsLoading, fetchTimeline, timeline, fetchPayoff } = useDebts();
  const { monthlyIncome, loading: incomeLoading } = useAllocations();

  const [freedomMonths, setFreedomMonths] = useState<number | null>(null);
  const [attackOrder, setAttackOrder] = useState<{ name: string | null; monthPaidOff: number }[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (debtsLoading) return;
    (async () => {
      await fetchTimeline(1);
      const payoff = await fetchPayoff(0, 'consumer');
      if (payoff?.snowball) {
        setFreedomMonths(payoff.snowball.months);
        setAttackOrder(payoff.snowball.payoffOrder);
      }
      setReady(true);
    })();
  }, [debtsLoading]);

  if (!ready || incomeLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasIncome = monthlyIncome > 0;
  const consumerDebtBalance = debts
    .filter(d => d.status === 'active' && ['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan'].includes(d.kind))
    .reduce((s, d) => s + d.currentBalance, 0);
  const inDebt = consumerDebtBalance > 0;
  const pctCommitted = timeline[0]?.pctCommitted ?? null;

  const freedomDate = freedomMonths != null && freedomMonths > 0 && freedomMonths < 600
    ? new Date(new Date().setMonth(new Date().getMonth() + freedomMonths))
    : null;

  return (
    <div>
      <div className="w-12 h-12 rounded-full bg-secondary/10 text-secondary flex items-center justify-center mb-4">
        <PartyPopper className="w-6 h-6" />
      </div>
      <h1 className="text-2xl font-display tracking-tight mb-2">
        {inDebt ? t('onboarding.result.titleDebt') : t('onboarding.result.titleFree')}
      </h1>
      <p className="text-muted-foreground mb-8 text-sm">
        {inDebt ? t('onboarding.result.subtitleDebt') : t('onboarding.result.subtitleFree')}
      </p>

      {!hasIncome ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground mb-6">
          {t('onboarding.result.missingIncome')}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-6 mb-6">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('onboarding.result.committedFuture')}</span>
          <div className="text-5xl font-display mt-1">{pctCommitted != null ? `${pctCommitted.toFixed(0)}%` : '—'}</div>
          <p className="text-xs text-muted-foreground mt-2">{t('onboarding.result.committedFutureDesc')}</p>
        </div>
      )}

      {inDebt && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-border bg-card p-6 mb-6">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('onboarding.result.freedomDate')}</span>
          {freedomDate ? (
            <div className="text-2xl font-display mt-1">
              {freedomDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">{t('onboarding.result.freedomUnknown')}</p>
          )}
          {attackOrder.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">{t('onboarding.result.attackOrder')}</p>
              {attackOrder.map((d, i) => (
                <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                  <span>{i + 1}. {d.name ?? t('onboarding.result.unnamedDebt')}</span>
                  <span className="text-muted-foreground">{t('onboarding.result.monthN', { n: d.monthPaidOff })}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4">{t('onboarding.result.debtStateHint')}</p>
        </motion.div>
      )}

      <button
        onClick={onDone}
        className="w-full py-3 bg-foreground text-background rounded-xl hover:bg-foreground/90 transition-colors font-medium"
      >
        {t('onboarding.result.goToDashboard')}
      </button>
    </div>
  );
}
