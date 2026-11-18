import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Coffee, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { merchantLabel, useHormiga, type HormigaSubscription, type SubscriptionDecision } from '../hooks/useHormiga';
import { useMoney } from '../onboarding/useMoney';

// The server's threshold (server/lib/hormiga.ts SMALL_MAX_CENTS), for the text.
const SMALL_LIMIT_EUROS = 10;

interface HormigaSheetProps {
  isOpen: boolean;
  onClose: () => void;
  month: string;
}

// The full gastos hormiga view (LPBETA-12), opened from Activity (and from
// Home's card and the monthly email): "Tus suscripciones" with their monthly
// and yearly totals, price rises and "la quiero" / "voy a cancelarla" (a
// reminder: the app cancels nothing), then the small frequent expenses of the
// month, each carried to the year.
export function HormigaSheet({ isOpen, onClose, month }: HormigaSheetProps) {
  const { t } = useTranslation();
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="hormiga-sheet-title"
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 id="hormiga-sheet-title" className="text-2xl font-display">{t('hormiga.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('hormiga.subtitle')}</p>
              </div>
              <button onClick={onClose} aria-label={t('hormiga.close')} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors shrink-0">
                <X className="w-5 h-5" />
              </button>
            </div>
            <HormigaContent month={month} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Mounted only while the sheet is open, so it reads fresh figures each time.
function HormigaContent({ month }: { month: string }) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { data, loading, failed, decide } = useHormiga(month);
  const approx = (v: number) => fmt(Math.round(v));

  if (loading && !data) {
    return <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;
  }
  if (failed || !data) return <p className="text-sm text-muted-foreground">{t('hormiga.loadFailed')}</p>;

  const { totals, subscriptions, small } = data;
  if (subscriptions.length === 0 && small.length === 0) {
    return (
      <div className="text-center py-10 space-y-3">
        <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto">
          <Coffee className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="font-display text-lg">{t('hormiga.emptyTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('hormiga.emptyDesc')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Together, carried to the year, tied to saving */}
      <div className="bg-surface-sunk rounded-2xl p-5 space-y-1">
        <p className="text-xs text-muted-foreground">{t('hormiga.cardMonth', { amount: fmt(totals.monthlyTotal) })}</p>
        <p className="text-2xl font-display tabular-nums">{t('hormiga.perYear', { amount: approx(totals.yearlyTotal) })}</p>
        <p className="text-sm text-reed">{t('hormiga.half', { amount: approx(totals.halfYearly) })}</p>
      </div>

      {/* Tus suscripciones */}
      <section aria-labelledby="hormiga-subs" className="space-y-3">
        <h3 id="hormiga-subs" className="font-display text-lg">{t('hormiga.subscriptionsTitle')}</h3>
        {subscriptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('hormiga.subscriptionsEmpty')}</p>
        ) : (
          <>
            <p className="text-sm">{t('hormiga.subscriptionsTotal', { monthly: fmt(totals.subscriptionsMonthly), yearly: approx(totals.subscriptionsYearly) })}</p>
            <ul className="space-y-3">
              {subscriptions.map(s => <SubscriptionRow key={s.merchant} sub={s} onDecide={decide} />)}
            </ul>
          </>
        )}
      </section>

      {/* Small and frequent */}
      <section aria-labelledby="hormiga-small" className="space-y-3">
        <div>
          <h3 id="hormiga-small" className="font-display text-lg">{t('hormiga.smallTitle')}</h3>
          <p className="text-xs text-muted-foreground">{t('hormiga.smallDesc', { limit: fmt(SMALL_LIMIT_EUROS) })}</p>
        </div>
        {small.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('hormiga.smallEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {small.map(x => (
              <li key={`${x.kind}:${x.key}`} className="border border-border rounded-2xl px-4 py-3 space-y-0.5">
                <p className="text-sm font-medium flex items-center gap-2 min-w-0">
                  {x.icon && <span aria-hidden="true">{x.icon}</span>}
                  <span className="truncate">{x.kind === 'merchant' ? merchantLabel(x.label) : x.label}</span>
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {t('hormiga.smallLine', { unit: fmt(x.amount), count: x.count, total: fmt(x.total), yearly: approx(x.yearlyTotal) })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SubscriptionRow({ sub, onDecide }: { sub: HormigaSubscription; onDecide: (id: string, d: SubscriptionDecision | null) => Promise<boolean> }) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const [saving, setSaving] = useState(false);

  const choose = async (decision: SubscriptionDecision | null) => {
    if (!sub.id) return;
    setSaving(true);
    const ok = await onDecide(sub.id, decision);
    setSaving(false);
    if (!ok) toast.error(t('hormiga.decisionFailed'));
  };

  return (
    <li className="border border-border rounded-2xl px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium flex items-center gap-2 min-w-0">
            <span className="truncate">{merchantLabel(sub.merchant)}</span>
            {sub.isNew && <span className="text-xs px-2 py-0.5 rounded-full bg-pool-soft text-pool shrink-0">{t('hormiga.new')}</span>}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {fmt(sub.amount)} {t(`hormiga.cadence.${sub.cadence}`)}
          </p>
        </div>
        <p className="text-sm tabular-nums shrink-0">{t('hormiga.perYear', { amount: fmt(Math.round(sub.yearlyAmount)) })}</p>
      </div>

      {sub.previousAmount !== null && (
        <p className="text-xs bg-sun-soft text-sun-ink rounded-lg px-3 py-1.5">{t('hormiga.priceRise', { from: fmt(sub.previousAmount), to: fmt(sub.amount) })}</p>
      )}
      {sub.isNew && <p className="text-xs text-muted-foreground">{t('hormiga.newHint')}</p>}
      {sub.chargedAfterCancel && (
        <p className="text-xs bg-sun-soft text-sun-ink rounded-lg px-3 py-1.5">{t('hormiga.chargedAfterCancel')}</p>
      )}

      {sub.id && (
        sub.decision === null ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => choose('keep')} disabled={saving} className="px-3 py-1.5 border border-border rounded-xl hover:bg-muted transition-colors text-xs disabled:opacity-50">
              {t('hormiga.keep')}
            </button>
            <button onClick={() => choose('cancel')} disabled={saving} className="px-3 py-1.5 border border-border rounded-xl hover:bg-muted transition-colors text-xs disabled:opacity-50">
              {t('hormiga.cancel')}
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${sub.decision === 'keep' ? 'bg-reed-soft text-reed' : 'bg-sun-soft text-sun-ink'}`}>
                {sub.decision === 'keep' ? t('hormiga.kept') : t('hormiga.toCancel')}
              </span>
              <button onClick={() => choose(null)} disabled={saving} className="text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50">
                {t('hormiga.undo')}
              </button>
            </div>
            {sub.decision === 'cancel' && <p className="text-xs text-muted-foreground">{t('hormiga.cancelReminder')}</p>}
          </div>
        )
      )}
    </li>
  );
}
