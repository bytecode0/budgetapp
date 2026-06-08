import { useState, useEffect } from 'react';
import { X, Check, Loader2, Briefcase, Laptop, ArrowLeftRight, Wallet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAccounts } from '../hooks/useAccounts';
import { useIncome, type Income, type IncomeCategory } from '../hooks/useIncome';

const CATEGORIES: { key: IncomeCategory; icon: typeof Briefcase }[] = [
  { key: 'salary', icon: Briefcase },
  { key: 'freelance', icon: Laptop },
  { key: 'transfer_in', icon: ArrowLeftRight },
  { key: 'other', icon: Wallet },
];

interface AddIncomeProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  defaultDate?: string; // YYYY-MM-DD
  editing?: Income | null; // when set, the modal edits this income
}

export function AddIncome({ isOpen, onClose, onSaved, defaultDate, editing }: AddIncomeProps) {
  const { t } = useTranslation();
  const { accounts } = useAccounts();
  const { createIncome, updateIncome } = useIncome();

  const activeAccounts = accounts.filter(a => !a.isArchived);

  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<IncomeCategory>('salary');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  // Hydrate the form from the editing target / defaults whenever it opens.
  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setAmount(String(editing.amount));
      setCategory(editing.category);
      setAccountId(editing.accountId);
      setDescription(editing.description);
      setDate(editing.date.slice(0, 10));
    } else {
      setAmount('');
      setCategory('salary');
      setAccountId(activeAccounts[0]?.id ?? null);
      setDescription('');
      setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing]);

  const handleSubmit = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { toast.error(t('addIncome.invalidAmount')); return; }
    setSaving(true);
    const payload = { amount: parsed, description: description.trim(), category, accountId, date };
    const result = editing
      ? await updateIncome(editing.id, payload)
      : await createIncome(payload);
    setSaving(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    toast.success(editing ? t('addIncome.savedOk') : t('addIncome.addedOk'));
    onSaved?.();
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
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-display">{editing ? t('addIncome.editTitle') : t('addIncome.title')}</h2>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('addIncome.amount')}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-600">€</span>
                <input
                  type="number"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  min="0"
                  step="0.01"
                  className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-lg font-display"
                />
              </div>
            </div>

            {/* Category */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('addIncome.category')}</label>
              <div className="grid grid-cols-4 gap-2">
                {CATEGORIES.map(({ key, icon: Icon }) => {
                  const selected = category === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setCategory(key)}
                      className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-colors text-xs ${selected ? 'border-emerald-500 bg-emerald-500/5 text-emerald-600' : 'border-border hover:bg-muted'}`}
                    >
                      <Icon className="w-4 h-4" />
                      {t(`addIncome.cat.${key}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Account */}
            {activeAccounts.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('addIncome.account')}</label>
                <select
                  value={accountId ?? ''}
                  onChange={e => setAccountId(e.target.value || null)}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                >
                  {activeAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Note */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('addIncome.noteOptional')}</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('addIncome.notePlaceholder')}
                className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
              />
            </div>

            {/* Date */}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('addIncome.date')}</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={saving}
              className="w-full py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-600/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editing ? t('addIncome.save') : t('addIncome.addAction')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
