import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Check, Landmark, ArrowRight, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { ImportPreviewStep } from '../import/ImportPreviewStep';
import { apiErrorMessage } from '../../lib/apiErrors';
import type { ImportPreview, ImportSummary, ConfirmRow } from '../../hooks/useImport';
import type { BankResult, LearnedRule } from '../../hooks/useBanking';
import type { BankReviewTarget } from '../../../../shared/bankStrip';

export type { BankReviewTarget };

interface BankReviewProps {
  /** The accounts to review, one after another (shared/bankStrip.ts
   *  reviewQueue: first-time reviews first). Null: closed. */
  queue: BankReviewTarget[] | null;
  onClose: () => void;
  /** After each account's confirm: refresh what the screen shows. */
  onDone: () => void;
  preview: (connectionId: string, accountId: string) => Promise<BankResult<ImportPreview & { accountId: string; pendingCount: number }>>;
  confirm: (connectionId: string, accountId: string, rows: ConfirmRow[], dismissed: string[]) => Promise<BankResult<{ inserted: number; summary: ImportSummary; learned: LearnedRule[] }>>;
}

// The review of bank movements (§5.5): the import wizard's own preview step,
// fed by the bank instead of a file, over whatever screen opened it. Nothing
// is written until the user confirms; after the first confirm the daily sync
// takes over. Several accounts are reviewed in one flow.
export function BankReview({ queue, onClose, onDone, preview, confirm }: BankReviewProps) {
  const { t } = useTranslation();
  // The position belongs to the queue it was taken in: a new queue starts at 0
  // on its very first render (no stale account fetched in between).
  const [step, setStep] = useState<{ queue: BankReviewTarget[] | null; index: number }>({ queue: null, index: 0 });
  const index = step.queue === queue ? step.index : 0;
  const [data, setData] = useState<(ImportPreview & { pendingCount: number }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [starting, setStarting] = useState(false);
  // What the last confirm taught, for the toast once it's done.
  const learnedRef = useRef<LearnedRule[]>([]);

  const target = queue?.[index] ?? null;
  const next = queue?.[index + 1] ?? null;

  useEffect(() => {
    setData(null);
    setSummary(null);
    if (!target) return;
    let current = true;
    setLoading(true);
    preview(target.connectionId, target.accountId).then(res => {
      if (!current) return; // closed, or moved on to another account
      setLoading(false);
      if (!res.ok) { toast.error(apiErrorMessage(t, { code: res.code, error: t('banking.errors.previewFailed') })); onClose(); return; }
      setData(res);
    });
    return () => { current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.connectionId, target?.accountId]);

  const runConfirm = async (rows: ConfirmRow[], dismissed: string[]) => {
    const res = await confirm(target!.connectionId, target!.accountId, rows, dismissed);
    learnedRef.current = res.ok ? res.learned ?? [] : [];
    return res.ok ? { inserted: res.inserted, summary: res.summary } : { error: res.error, code: res.code };
  };

  const finish = (s: ImportSummary) => {
    setSummary(s);
    onDone();
    const learned = learnedRef.current;
    learnedRef.current = [];
    if (learned.length === 1 && learned[0].allocationName) {
      toast.success(t('banking.learnedOne', { merchant: learned[0].label, line: learned[0].allocationName }));
    } else if (learned.length > 0) {
      toast.success(t('banking.learnedMany', { count: learned.length }));
    }
  };

  // Nothing new to keep: confirming an empty review still starts the daily sync.
  const startWithoutRows = async () => {
    setStarting(true);
    const res = await runConfirm([], []);
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
          className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-3xl shadow-soft p-6 w-full max-w-2xl space-y-5 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Landmark className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-2xl font-display truncate">{t('banking.reviewTitle', { name: target.accountName })}</h2>
                {queue && queue.length > 1 && (
                  <span className="text-xs text-muted-foreground shrink-0">{t('banking.reviewStep', { current: index + 1, total: queue.length })}</span>
                )}
              </div>
              <button onClick={onClose} aria-label={t('import.close')} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!summary && (
              <p className="text-sm flex items-start gap-2 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3">
                <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                {t('banking.reviewInstruction')}
              </p>
            )}

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
                    // Remounted per account: its selection starts from the server's.
                    key={target.accountId}
                    variant="bank"
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
                <div className="bg-reed-soft rounded-2xl p-5 space-y-2">
                  <p className="font-display text-lg flex items-center gap-2">
                    <Check className="w-5 h-5 text-reed" /> {t('import.summaryTitle')}
                  </p>
                  <p className="text-sm">
                    {summaryParts(summary).length > 0 ? summaryParts(summary).join(', ') : t('import.summaryNothing')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('banking.reviewDoneHint')}</p>
                </div>
                {next ? (
                  <button onClick={() => setStep({ queue, index: index + 1 })} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm flex items-center justify-center gap-2">
                    {t('banking.reviewNext', { name: next.accountName })} <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button onClick={onClose} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm">
                    {t('import.done')}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
