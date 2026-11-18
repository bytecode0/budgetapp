import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Coffee } from 'lucide-react';
import { merchantLabel, useHormiga } from '../hooks/useHormiga';
import { useMoney } from '../onboarding/useMoney';

// Home's summary of gastos hormiga (LPBETA-12): subscriptions and small
// frequent expenses together, carried to the year and tied to saving ("si lo
// reduces a la mitad…"). The full list, with "la quiero" / "voy a
// cancelarla", is in Activity (HormigaSheet). Hidden when there is nothing.
export function HormigaCard({ month, onOpen }: { month: string; onOpen?: () => void }) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { data } = useHormiga(month);
  if (!data || (data.subscriptions.length === 0 && data.small.length === 0)) return null;

  const { totals } = data;
  // Yearly figures are approximations ("~690 €"): whole euros, rounded only here.
  const approx = (v: number) => fmt(Math.round(v));
  const rises = data.subscriptions.filter(s => s.previousAmount !== null).length;
  const top = [
    ...data.subscriptions.map(s => ({ key: `s:${s.merchant}`, label: merchantLabel(s.merchant), yearly: s.yearlyAmount })),
    ...data.small.map(x => ({ key: `h:${x.key}`, label: x.kind === 'merchant' ? merchantLabel(x.label) : x.label, yearly: x.yearlyTotal })),
  ].sort((a, b) => b.yearly - a.yearly).slice(0, 3);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.2 }}
      aria-labelledby="hormiga-heading"
      className="bg-card border border-border rounded-3xl p-6 space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-2xl bg-sun-soft text-sun-ink flex items-center justify-center shrink-0">
          <Coffee className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="hormiga-heading" className="text-lg font-semibold">{t('hormiga.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('hormiga.cardMonth', { amount: fmt(totals.monthlyTotal) })}</p>
        </div>
      </div>

      <p className="text-2xl font-display tabular-nums">{t('hormiga.perYear', { amount: approx(totals.yearlyTotal) })}</p>

      <ul className="space-y-1.5">
        {top.map(item => (
          <li key={item.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="tabular-nums text-muted-foreground shrink-0">{t('hormiga.perYear', { amount: approx(item.yearly) })}</span>
          </li>
        ))}
      </ul>

      {rises > 0 && (
        <p className="text-sm bg-sun-soft text-sun-ink rounded-xl px-4 py-2.5">{t('hormiga.priceRisesNotice', { count: rises })}</p>
      )}

      <p className="text-sm text-reed">{t('hormiga.half', { amount: approx(totals.halfYearly) })}</p>

      {onOpen && (
        <button
          onClick={onOpen}
          className="text-sm text-primary flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
        >
          {t('hormiga.viewAll')} <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </motion.section>
  );
}
