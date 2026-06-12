import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, RefreshCw, Check, Ban, Repeat, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useRecurring } from '../hooks/useRecurring';
import { useAllocations } from '../hooks/useAllocations';

interface RecurringManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function RecurringManager({ isOpen, onClose }: RecurringManagerProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { commitments, loading, fetchRecurring, update } = useRecurring();
  const { allocations } = useAllocations();

  const fixedAllocations = allocations.filter(a => a.type === 'fixed');
  // Per-row selected allocation before confirming (defaults to the suggestion).
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const fmtEuro = (v: number) => `€${v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const detected = commitments.filter(c => c.status === 'detected');
  const confirmed = commitments.filter(c => c.status === 'confirmed');

  const linkValue = (id: string, fallback: string | null) => links[id] ?? fallback ?? '';

  const confirm = async (id: string, fallback: string | null) => {
    setBusyId(id);
    const allocationId = linkValue(id, fallback) || null;
    const res = await update(id, { status: 'confirmed', allocationId });
    setBusyId(null);
    if (res.error) toast.error(res.error); else toast.success(t('recurring.confirmedOk'));
  };

  const setStatus = async (id: string, status: 'ignored' | 'detected') => {
    setBusyId(id);
    const res = await update(id, { status });
    setBusyId(null);
    if (res.error) toast.error(res.error);
    else toast.success(status === 'ignored' ? t('recurring.ignoredOk') : t('recurring.restoredOk'));
  };

  const changeLink = async (id: string, allocationId: string | null) => {
    setBusyId(id);
    const res = await update(id, { allocationId });
    setBusyId(null);
    if (res.error) toast.error(res.error);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg space-y-5 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Repeat className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-display">{t('recurring.title')}</h2>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => fetchRecurring()} className="p-2 rounded-lg hover:bg-muted transition-colors" title={t('recurring.rescan')}>
                  <RefreshCw className="w-4 h-4 text-muted-foreground" />
                </button>
                <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">{t('recurring.subtitle')}</p>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : detected.length === 0 && confirmed.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto">
                  <Repeat className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="font-display text-lg">{t('recurring.emptyTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('recurring.emptyDesc')}</p>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Detected — awaiting review */}
                {detected.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('recurring.detected')}</p>
                    {detected.map(c => (
                      <div key={c.id} className="border border-border rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate capitalize">{c.merchant}</p>
                            <p className="text-xs text-muted-foreground">
                              {fmtEuro(c.avgAmount)} · {t('recurring.monthly')}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => confirm(c.id, c.allocationId)}
                              disabled={busyId === c.id}
                              className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-xs disabled:opacity-50"
                            >
                              {busyId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              {t('recurring.confirm')}
                            </button>
                            <button
                              onClick={() => setStatus(c.id, 'ignored')}
                              disabled={busyId === c.id}
                              className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-xs disabled:opacity-50"
                            >
                              <Ban className="w-3 h-3" /> {t('recurring.ignore')}
                            </button>
                          </div>
                        </div>
                        {fixedAllocations.length > 0 && (
                          <select
                            value={linkValue(c.id, c.allocationId)}
                            onChange={e => setLinks(prev => ({ ...prev, [c.id]: e.target.value }))}
                            className="w-full border border-border rounded-lg px-3 py-2 bg-background outline-none focus:border-primary text-sm"
                          >
                            <option value="">{t('recurring.noLink')}</option>
                            {fixedAllocations.map(a => (
                              <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Confirmed — active commitments */}
                {confirmed.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('recurring.confirmed')}</p>
                    {confirmed.map(c => (
                      <div key={c.id} className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate capitalize">{c.merchant}</p>
                            <p className="text-xs text-muted-foreground">
                              {fmtEuro(c.avgAmount)} · {t('recurring.monthly')}
                              {c.allocation && <> · {c.allocation.icon} {c.allocation.name}</>}
                            </p>
                          </div>
                          <button
                            onClick={() => setStatus(c.id, 'ignored')}
                            disabled={busyId === c.id}
                            className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-xs shrink-0 disabled:opacity-50"
                          >
                            <Ban className="w-3 h-3" /> {t('recurring.ignore')}
                          </button>
                        </div>
                        {fixedAllocations.length > 0 && (
                          <select
                            value={c.allocationId ?? ''}
                            onChange={e => changeLink(c.id, e.target.value || null)}
                            className="w-full border border-border rounded-lg px-3 py-2 bg-background outline-none focus:border-primary text-sm"
                          >
                            <option value="">{t('recurring.noLink')}</option>
                            {fixedAllocations.map(a => (
                              <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
