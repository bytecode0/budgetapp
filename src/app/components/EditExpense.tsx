import { useState, useEffect } from 'react';
import { X, Check, Euro, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { Expense } from '../hooks/useExpenses';
import type { Allocation } from '../hooks/useAllocations';

interface EditExpenseProps {
  isOpen: boolean;
  expense: Expense | null;
  allocations: Allocation[];
  onClose: () => void;
  onSave: (payload: { amount: number; description: string; allocationId: string | null; date: string }) =>
    Promise<{ error?: string } | { expense: Expense }>;
}

export function EditExpense({ isOpen, expense, allocations, onClose, onSave }: EditExpenseProps) {
  const { t } = useTranslation();

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [allocationId, setAllocationId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Sync form when the target expense changes
  useEffect(() => {
    if (!expense) return;
    setAmount(String(expense.amount));
    setDescription(expense.description ?? '');
    setAllocationId(expense.allocationId);
    setDate(expense.date.slice(0, 10));
  }, [expense]);

  const handleSubmit = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { toast.error(t('editExpense.invalidAmount')); return; }
    setSaving(true);
    const result = await onSave({ amount: parsed, description: description.trim(), allocationId, date });
    setSaving(false);
    if ('error' in result && result.error) {
      toast.error(result.error);
    } else {
      toast.success(t('editExpense.saved'));
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && expense && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />
          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 60, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 bottom-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:w-full md:max-w-md bg-card border border-border rounded-3xl shadow-2xl z-50 overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
              <h2 className="text-xl font-display">{t('editExpense.title')}</h2>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 pb-6 pt-5 space-y-4">
              {/* Amount */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">{t('editExpense.amount')}</label>
                <div className="relative">
                  <Euro className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="number" min="0" step="0.01" value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-background border border-border rounded-xl outline-none focus:border-primary transition-colors"
                  />
                </div>
              </div>

              {/* Allocation (category) — this is what drives the "learn" rule */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">{t('editExpense.category')}</label>
                <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {allocations.map(a => (
                    <button
                      key={a.id}
                      onClick={() => setAllocationId(a.id)}
                      className={`p-3 rounded-xl border-2 transition-all text-left ${
                        allocationId === a.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                      }`}
                    >
                      <div className="text-2xl mb-1">{a.icon}</div>
                      <p className="text-sm font-medium truncate">{a.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">{a.type}</p>
                    </button>
                  ))}
                  <button
                    onClick={() => setAllocationId(null)}
                    className={`p-3 rounded-xl border-2 transition-all text-left ${
                      allocationId === null ? 'border-muted-foreground/50 bg-muted' : 'border-border hover:border-muted-foreground/30'
                    }`}
                  >
                    <div className="text-2xl mb-1">❓</div>
                    <p className="text-sm font-medium">{t('addExpense.unassigned')}</p>
                  </button>
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">{t('editExpense.note')}</label>
                <input
                  type="text" value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl outline-none focus:border-primary transition-colors text-sm"
                />
              </div>

              {/* Date */}
              <div>
                <label className="text-sm text-muted-foreground mb-2 block">{t('editExpense.date')}</label>
                <input
                  type="date" value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full px-4 py-3 bg-background border border-border rounded-xl outline-none focus:border-primary transition-colors text-sm"
                />
              </div>

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {t('editExpense.save')}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
