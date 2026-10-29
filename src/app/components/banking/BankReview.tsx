import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Check, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ImportPreviewStep } from '../import/ImportPreviewStep';
import { apiErrorMessage } from '../../lib/apiErrors';
import type { ImportPreview, ImportSummary, ConfirmRow } from '../../hooks/useImport';
import type { BankResult } from '../../hooks/useBanking';

export interface BankReviewTarget { connectionId: string; accountId: string; accountName: string; firstTime: boolean }

interface BankReviewProps {
  target: BankReviewTarget | null;
  onClose: () => void;
  onDone: () => void;
  preview: (connectionId: string, accountId: string) => Promise<BankResult<ImportPreview & { accountId: string; pendingCount: number }>>;
  confirm: (connectionId: string, accountId: string, rows: ConfirmRow[]) => Promise<BankResult<{ inserted: number; summary: ImportSummary }>>;
}

// The review of an account's bank movements (§5.5): the import wizard's own
// preview step, fed by the bank instead of a file. Nothing is written until
// the user confirms; after the first confirm the daily sync takes over.
export function BankReview({ target, onClose, onDone, preview, confirm }: BankReviewProps) {
  const { t } = useTranslation();
  const [data, setData] = useState<(ImportPreview & { pendingCount: number }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setData(null);
    setSummary(null);
    if (!target) return;
    setLoading(true);
    preview(target.connectionId, target.accountId).then(res => {
      setLoading(false);
      if (!res.ok) { toast.error(apiErrorMessage(t, { code: res.code, error: t('banking.errors.previewFailed') })); onClose(); return; }
      setData(res);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.connectionId, target?.accountId]);

  const runConfirm = async (rows: ConfirmRow[]) => {
    const res = await confirm(target!.connectionId, target!.accountId, rows);
    return res.ok ? { inserted: res.inserted, summary: res.summary } : { error: res.error, code: res.code };
  };

  const finish = (s: ImportSummary) => { setSummary(s); onDone(); };

  // Nothing new to keep: confirming an empty review still starts the daily sync.
  const startWithoutRows = async () => {
    setStarting(true);
    const res = await runConfirm([]);
    setStarting(false);
    if ('error' in res) { toast.error(apiErrorMessage(t, { code: res.code, error: t('import.confirmFailed') })); return; }
    finish(res.summary);
  };

  const summaryParts = (s: ImportSummary): string[] => [
    ...(s.expenses ? [t('import.summaryExpenses', { count: s.expenses })] : []),
    ...(s.incomes ? [t('import.summaryIncomes', { count: s.incomes })] : []),
    ...(s.refunds ? [t('import.summaryRefunds', { count: s.refunds })] : []),
    ...s.payments.map(p => (p.name
      ? t('import.summaryPayments', { count: p.count, name: p.name })
      : t('import.summaryPaymentsUnnamed', { count: p.count }))),
  ];

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl space-y-5 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Landmark className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-2xl font-display truncate">{t('banking.reviewTitle', { name: target.accountName })}</h2>
              </div>
              <button onClick={onClose} aria-label={t('import.close')} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loading && (
              <div className="flex flex-col items-center gap-3 py-10">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">{t('banking.reviewLoading')}</p>
              </div>
            )}

            {!loading && data && !summary && (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">{t(target.firstTime ? 'banking.reviewIntroFirst' : 'banking.reviewIntro')}</p>
                {data.pendingCount > 0 && (
                  <p className="text-xs text-muted-foreground">{t('banking.reviewPendingNote', { count: data.pendingCount })}</p>
                )}
                {data.newCount === 0 ? (
                  <div className="space-y-4">
                    <div className="text-center py-8 space-y-2">
                      <p className="font-display text-lg">{t('banking.reviewNothingNew')}</p>
                      <p className="text-sm text-muted-foreground">{t('banking.reviewNothingNewDesc')}</p>
                    </div>
                    <button
                      onClick={startWithoutRows}
                      disabled={starting}
                      className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {t('banking.reviewStart')}
                    </button>
                  </div>
                ) : (
                  <ImportPreviewStep
                    data={data}
                    accountId={target.accountId}
                    // Merchant names from the bank are never sent to an AI.
                    aiEnabled={false}
                    onSignChange={() => {}}
                    signLoading={false}
                    onConfirm={runConfirm}
                    onConfirmed={finish}
                  />
                )}
              </div>
            )}

            {summary && (
              <div className="space-y-5">
                <div className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 space-y-2">
                  <p className="font-display text-lg flex items-center gap-2">
                    <Check className="w-5 h-5 text-emerald-600" /> {t('import.summaryTitle')}
                  </p>
                  <p className="text-sm">
                    {summaryParts(summary).length > 0 ? summaryParts(summary).join(', ') : t('import.summaryNothing')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('banking.reviewDoneHint')}</p>
                </div>
                <button onClick={onClose} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm">
                  {t('import.done')}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
