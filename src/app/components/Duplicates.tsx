import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Copy, Merge, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import type { DuplicateGroup } from '../hooks/useDuplicates';

interface DuplicatesProps {
  isOpen: boolean;
  onClose: () => void;
  groups: DuplicateGroup[];
  loading: boolean;
  onMerge: (keepId: string, removeIds: string[]) => Promise<{ error?: string; removed?: number }>;
  onMerged?: () => void;
}

export function Duplicates({ isOpen, onClose, groups, loading, onMerge, onMerged }: DuplicatesProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';

  const [keepByGroup, setKeepByGroup] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const fmtEuro = (v: number) => `€${v.toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const keepId = (groupIdx: number, group: DuplicateGroup) => keepByGroup[groupIdx] ?? group[0].id;

  const handleMerge = async (groupIdx: number, group: DuplicateGroup) => {
    const keep = keepId(groupIdx, group);
    const removeIds = group.filter(e => e.id !== keep).map(e => e.id);
    if (removeIds.length === 0) return;
    setBusy(groupIdx);
    const res = await onMerge(keep, removeIds);
    setBusy(null);
    if (res.error) { toast.error(res.error); return; }
    toast.success(t('duplicates.mergedOk', { count: res.removed ?? removeIds.length }));
    onMerged?.();
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
                <Copy className="w-5 h-5 text-amber-500" />
                <h2 className="text-2xl font-display">{t('duplicates.title')}</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">{t('duplicates.subtitle')}</p>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : groups.length === 0 ? (
              <div className="text-center py-10 space-y-3">
                <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/30 rounded-2xl flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                </div>
                <p className="font-display text-lg">{t('duplicates.emptyTitle')}</p>
                <p className="text-sm text-muted-foreground">{t('duplicates.emptyDesc')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {groups.map((group, gi) => {
                  const keep = keepId(gi, group);
                  return (
                    <div key={group.map(e => e.id).join('-')} className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-display">{fmtEuro(group[0].amount)} · {t('duplicates.copies', { count: group.length })}</p>
                        <button
                          onClick={() => handleMerge(gi, group)}
                          disabled={busy === gi}
                          className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-xs disabled:opacity-50"
                        >
                          {busy === gi ? <Loader2 className="w-3 h-3 animate-spin" /> : <Merge className="w-3 h-3" />}
                          {t('duplicates.merge')}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">{t('duplicates.keepHint')}</p>
                      <div className="space-y-2">
                        {group.map(e => (
                          <label
                            key={e.id}
                            className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${keep === e.id ? 'border-primary bg-primary/5' : 'border-border bg-background hover:bg-muted/50'}`}
                          >
                            <input
                              type="radio"
                              name={`keep-${gi}`}
                              checked={keep === e.id}
                              onChange={() => setKeepByGroup(prev => ({ ...prev, [gi]: e.id }))}
                              className="accent-primary"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm truncate">
                                {e.description || e.allocation?.name || t('activity.expense')}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {fmtDate(e.date)}
                                {e.account && <> · {e.account.name}</>}
                                {keep === e.id && <> · {t('duplicates.keptLabel')}</>}
                              </p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
