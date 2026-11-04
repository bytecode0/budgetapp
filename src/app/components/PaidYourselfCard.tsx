import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { bpsToPct } from '../../../shared/incomeShare';
import { useMoney } from '../onboarding/useMoney';
import { PayYourselfFirstPicker } from '../onboarding/PayYourselfFirstPicker';
import type { MonthSavings } from '../hooks/useMonthSavings';

interface PaidYourselfCardProps {
  savings: MonthSavings;
  /** Re-reads the figures after the share changes. */
  onChanged: () => void;
  /** Opens Plans, where contributions are recorded. */
  onSetAside?: () => void;
}

// Home's one answer (LPBETA-07): "Te has pagado X de Y este mes" — what the
// household set aside for itself (server/lib/payYourselfFirst.ts) against its
// "Págate a ti primero" share. The share is changed from here too.
export function PaidYourselfCard({ savings, onChanged, onSetAside }: PaidYourselfCardProps) {
  const { t } = useTranslation();
  const { fmt, locale } = useMoney();
  const [editing, setEditing] = useState(false);
  const bps = savings.payYourselfFirstBps;
  const pct = bps !== null ? bpsToPct(bps).toLocaleString(locale) : '';

  return (
    <>
      <div className="bg-pool text-on-pool rounded-3xl p-8 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{t('home.paidYourselfLabel')}</p>
        <p className="text-5xl font-display tabular-nums">{fmt(savings.paidYourself)}</p>
        <p className="text-sm">
          {bps === null
            ? t('home.paidYourselfNoGoal')
            : savings.householdIncome > 0
              ? t('home.paidYourselfOf', { goal: fmt(savings.payYourselfFirstGoal ?? 0), pct })
              : t('home.paidYourselfNoIncome', { pct })}
        </p>
        <div className="flex flex-wrap gap-2 pt-3">
          <button
            onClick={() => setEditing(true)}
            className="px-4 py-2 rounded-xl border border-on-pool/40 text-sm hover:bg-on-pool/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-pool"
          >
            {bps === null ? t('home.choosePct') : t('home.changePct')}
          </button>
          {onSetAside && bps !== null && (
            <button
              onClick={onSetAside}
              className="px-4 py-2 rounded-xl border border-on-pool/40 text-sm hover:bg-on-pool/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-pool"
            >
              {t('home.setAside')}
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setEditing(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pay-first-title"
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="pay-first-title" className="text-lg font-semibold">{t('home.payFirstSheetTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{t('onboarding.result.payFirst.desc')}</p>
                </div>
                <button onClick={() => setEditing(false)} aria-label={t('home.close')} className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <PayYourselfFirstPicker
                valueBps={bps}
                income={savings.householdIncome}
                onSaved={next => {
                  toast.success(t('home.payFirstSaved', { pct: bpsToPct(next).toLocaleString(locale) }));
                  onChanged();
                }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
