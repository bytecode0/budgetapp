import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Landmark, Link2, RefreshCw, AlertTriangle, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { useBanking } from '../../hooks/useBanking';
import { bankStrip, sinceParts, type BankReviewTarget, type StripConnection } from '../../../../shared/bankStrip';
import { BankPicker } from './BankPicker';
import { BankReview } from './BankReview';
import { BankStatusRetry } from './BankStatusRetry';
import { useBankActions } from './useBankActions';

/** "Your bank's movements, here": the one banking line at the top of Activity.
 *  Which line it is comes from shared/bankStrip.ts; only "connect" can be
 *  closed (for good, on every device). */
export function BankStrip({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const banking = useBanking();
  const { connecting, startConsent, syncingId, sync } = useBankActions(banking, onChanged, 'activity');
  const [showPicker, setShowPicker] = useState(false);
  const [queue, setQueue] = useState<BankReviewTarget[] | null>(null);

  const now = new Date();
  const strip = bankStrip({ availability: banking.availability, promptDismissed: banking.promptDismissed, connections: banking.connections, now });
  // While the first connections load, nothing (not a flash of "connect").
  if (banking.loading && strip.kind !== 'check_failed') return null;

  const dismiss = async () => {
    const res = await banking.dismissPrompt();
    if (!res.ok) toast.error(t('banking.errors.failed'));
  };

  const since = (c: StripConnection) => {
    if (!c.lastSyncedAt) return t('banking.stripNotSynced', { bank: c.institutionName });
    const { value, unit } = sinceParts(c.lastSyncedAt, now);
    const ago = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }).format(value, unit);
    return t('banking.stripUpdated', { bank: c.institutionName, ago });
  };

  const watch = 'bg-sun-soft text-sun-ink rounded-2xl px-5 py-4 flex items-center justify-between gap-3';
  const watchButton = 'h-9 px-3 rounded-lg bg-card text-foreground border border-line-strong text-xs font-medium hover:bg-muted transition-colors shrink-0 disabled:opacity-50 flex items-center gap-1.5';

  const content = (() => {
    switch (strip.kind) {
      case 'none':
        return null;
      case 'check_failed':
        return <BankStatusRetry onRetry={banking.checkStatus} />;
      case 'connect':
        return (
          <div className="bg-card border border-border rounded-2xl px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm flex-1 min-w-0">{t('banking.stripConnect')}</p>
            <button
              onClick={() => setShowPicker(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm flex items-center gap-2 shrink-0"
            >
              <Link2 className="w-4 h-4" /> {t('banking.stripConnectButton')}
            </button>
            <button onClick={dismiss} aria-label={t('banking.stripDismiss')} title={t('banking.stripDismiss')} className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        );
      case 'reconnect':
        return (
          <div className={watch}>
            <p className="text-sm flex gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-sun-ink shrink-0 mt-0.5" />
              {strip.expired
                ? t('banking.stripExpired', { bank: strip.connection.institutionName })
                : t('banking.stripExpiring', { bank: strip.connection.institutionName, count: strip.daysLeft })}
            </p>
            <button onClick={() => startConsent({ connectionId: strip.connection.id })} disabled={connecting} className={watchButton}>
              {t('banking.reconnect')}
            </button>
          </div>
        );
      case 'pending':
        return (
          <div className={watch}>
            <p className="text-sm flex gap-2 min-w-0">
              <ListChecks className="w-4 h-4 text-sun-ink shrink-0 mt-0.5" />
              <PendingText count={strip.count} bank={strip.bank} />
            </p>
            <button onClick={() => setQueue(strip.targets)} className={watchButton}>
              {t('banking.stripReview')}
            </button>
          </div>
        );
      case 'status':
        return (
          <div className="space-y-1">
            {strip.connections.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 min-w-0 truncate">
                  <Link2 className="w-3.5 h-3.5 shrink-0" /> {since(c)}
                </span>
                {c.isOwner && (
                  <button onClick={() => sync(c.id)} disabled={syncingId === c.id} title={t('banking.syncNow')} aria-label={t('banking.syncNow')} className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 shrink-0">
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingId === c.id ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
            ))}
          </div>
        );
    }
  })();

  return (
    <>
      {content && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }}>
          {content}
        </motion.div>
      )}
      <BankPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        fetchInstitutions={banking.fetchInstitutions}
        connecting={connecting}
        onChoose={startConsent}
      />
      <BankReview
        queue={queue}
        onClose={() => setQueue(null)}
        onDone={onChanged}
        preview={banking.preview}
        confirm={banking.confirm}
      />
    </>
  );
}

/** "3 movimientos de BBVA por revisar" — or, when only first reviews wait
 *  (nothing counted yet), "BBVA está listo para tu primera revisión". */
export function PendingText({ count, bank }: { count: number; bank: string | null }) {
  const { t } = useTranslation();
  if (count > 0) return <>{bank ? t('banking.pendingFromBank', { count, bank }) : t('banking.pendingCount', { count })}</>;
  return <>{bank ? t('banking.firstReviewFromBank', { bank }) : t('banking.firstReview')}</>;
}
