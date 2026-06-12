import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Check, Wallet, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAllocations, type BudgetSuggestionRow } from '../hooks/useAllocations';

interface BudgetSuggestionsProps {
  isOpen: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

// Reusable panel: shows per-category budget suggestions computed from spending
// history (deterministic, not AI). Defaults to selecting categories currently at
// €0 so it fills the gaps without touching budgets the user already set.
export function BudgetSuggestions({ isOpen, onClose, onApplied }: BudgetSuggestionsProps) {
  const { t } = useTranslation();
  const { monthlyIncome, fetchSuggestedBudgets, applyBudgets } = useAllocations();

  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [rows, setRows] = useState<BudgetSuggestionRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetchSuggestedBudgets(6).then(res => {
      const suggestions = res.suggestions ?? [];
      setRows(suggestions);
      // Default: fill the categories that have no budget yet.
      setSelected(new Set(suggestions.filter(r => r.current === 0).map(r => r.allocationId)));
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectedTotal = rows.filter(r => selected.has(r.allocationId)).reduce((s, r) => s + r.suggested, 0);
  const overIncome = monthlyIncome > 0 && selectedTotal > monthlyIncome;

  const handleApply = async () => {
    const budgets = rows
      .filter(r => selected.has(r.allocationId))
      .map(r => ({ id: r.allocationId, allocatedAmount: r.suggested }));
    if (budgets.length === 0) { onClose(); return; }
    setApplying(true);
    const res = await applyBudgets(budgets);
    setApplying(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success(t('budgets.applied', { count: res.updated ?? budgets.length }));
    onApplied?.();
    onClose();
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
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="w-5 h-5 text-primary" />
                <div>
                  <h2 className="text-2xl font-display">{t('budgets.title')}</h2>
                  <p className="text-xs text-muted-foreground">{t('budgets.subtitle')}</p>
                </div>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : rows.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <div className="w-14 h-14 bg-muted rounded-2xl flex items-center justify-center mx-auto">
                  <Wallet className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">{t('budgets.none')}</p>
              </div>
            ) : (
              <>
                <div className="border border-border rounded-xl divide-y divide-border max-h-[52vh] overflow-y-auto">
                  {rows.map(r => (
                    <label key={r.allocationId} className="flex items-center gap-3 p-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-primary shrink-0"
                        checked={selected.has(r.allocationId)}
                        onChange={() => toggle(r.allocationId)}
                      />
                      <span className="text-xl shrink-0">{r.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm truncate flex items-center gap-1.5">
                          {r.name}
                          {r.confidence === 'low' && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              {t('budgets.lowConfidence')}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('budgets.monthsObserved', { count: r.monthsObserved })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {r.current > 0 && (
                          <p className="text-[11px] text-muted-foreground line-through">€{r.current.toLocaleString()}</p>
                        )}
                        <p className="text-sm font-display">€{r.suggested.toLocaleString()}</p>
                      </div>
                    </label>
                  ))}
                </div>

                {overIncome && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    {t('budgets.overIncome', { total: selectedTotal.toLocaleString(), income: monthlyIncome.toLocaleString() })}
                  </div>
                )}

                <button
                  onClick={handleApply}
                  disabled={applying || selected.size === 0}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('budgets.apply', { count: selected.size })}
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
