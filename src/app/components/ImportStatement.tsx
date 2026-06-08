import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, FileSpreadsheet, Loader2, Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useAccounts } from '../hooks/useAccounts';
import { useAllocations } from '../hooks/useAllocations';
import { useImport, type ImportPreview, type ConfirmRow } from '../hooks/useImport';

interface ImportStatementProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export function ImportStatement({ isOpen, onClose, onImported }: ImportStatementProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { accounts } = useAccounts();
  const { allocations } = useAllocations();
  const { loading, confirming, preview, confirm } = useImport();

  const activeAccounts = accounts.filter(a => !a.isArchived);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allocByRow, setAllocByRow] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!isOpen) { setData(null); setSelected(new Set()); setAllocByRow({}); }
    if (isOpen && !accountId && activeAccounts.length > 0) setAccountId(activeAccounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fmtEuro = (v: number) => `€${Math.abs(v).toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const res = await preview(file);
    if (res.error) { toast.error(res.error); return; }
    const p = res.preview!;
    setData(p);
    // Default: select all new rows; pre-fill suggested allocation per expense.
    setSelected(new Set(p.rows.filter(r => r.status === 'new').map(r => r.externalId)));
    setAllocByRow(Object.fromEntries(p.rows.filter(r => r.suggestedAllocationId).map(r => [r.externalId, r.suggestedAllocationId!])));
  };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleConfirm = async () => {
    if (!data) return;
    const rows: ConfirmRow[] = data.rows
      .filter(r => r.status === 'new' && selected.has(r.externalId))
      .map(r => ({
        kind: r.kind,
        externalId: r.externalId,
        date: r.date,
        description: r.description,
        merchant: r.merchant,
        amount: r.amount,
        allocationId: r.kind === 'expense' ? (allocByRow[r.externalId] || null) : undefined,
      }));
    if (rows.length === 0) { toast.error(t('import.nothingSelected')); return; }
    const res = await confirm(accountId, rows);
    if (res.error) { toast.error(res.error); return; }
    toast.success(t('import.importedOk', { count: res.inserted ?? rows.length }));
    onImported?.();
    onClose();
  };

  const selectedCount = data ? data.rows.filter(r => r.status === 'new' && selected.has(r.externalId)).length : 0;

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
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl space-y-5 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {data && (
                  <button onClick={() => setData(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-display">{t('import.title')}</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!data ? (
              /* ── Step 1: pick account + file ── */
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground">{t('import.subtitle')}</p>

                {activeAccounts.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('import.account')}</label>
                    <select
                      value={accountId ?? ''}
                      onChange={e => setAccountId(e.target.value || null)}
                      className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                    >
                      {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}

                <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-2xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
                  {loading ? <Loader2 className="w-8 h-8 animate-spin text-primary" /> : <Upload className="w-8 h-8 text-muted-foreground" />}
                  <span className="text-sm text-muted-foreground">{loading ? t('import.reading') : t('import.dropHint')}</span>
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    disabled={loading}
                    onChange={e => handleFile(e.target.files?.[0])}
                  />
                </label>
              </div>
            ) : (
              /* ── Step 2: preview + confirm ── */
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary">{t('import.newCount', { count: data.newCount })}</span>
                  <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.dupCount', { count: data.duplicateCount })}</span>
                  <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.expenseCount', { count: data.expenseCount })}</span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('import.incomeCount', { count: data.incomeCount })}</span>
                </div>

                <div className="border border-border rounded-xl divide-y divide-border max-h-[48vh] overflow-y-auto">
                  {data.rows.map(r => {
                    const isDup = r.status === 'duplicate';
                    return (
                      <div key={r.externalId} className={`flex items-center gap-3 p-3 ${isDup ? 'opacity-50' : ''}`}>
                        <input
                          type="checkbox"
                          className="accent-primary shrink-0"
                          checked={!isDup && selected.has(r.externalId)}
                          disabled={isDup}
                          onChange={() => toggle(r.externalId)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{r.description || r.merchant}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(r.date)}
                            {isDup && <> · {t('import.duplicate')}</>}
                          </p>
                        </div>
                        {r.kind === 'expense' && !isDup && allocations.length > 0 && (
                          <select
                            value={allocByRow[r.externalId] ?? ''}
                            onChange={e => setAllocByRow(prev => ({ ...prev, [r.externalId]: e.target.value }))}
                            className="text-xs border border-border rounded-lg px-2 py-1 bg-background outline-none focus:border-primary max-w-[40%]"
                          >
                            <option value="">{t('import.uncategorized')}</option>
                            {allocations.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                          </select>
                        )}
                        <p className={`text-sm font-display shrink-0 w-20 text-right ${r.kind === 'income' ? 'text-emerald-600' : ''}`}>
                          {r.kind === 'income' ? '+' : '-'}{fmtEuro(r.signedAmount)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirm}
                  disabled={confirming || selectedCount === 0}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('import.importSelected', { count: selectedCount })}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
