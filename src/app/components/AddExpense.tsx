import { useState, useEffect } from 'react';
import { X, Check, Euro, ChevronLeft, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAllocations } from '../hooks/useAllocations';
import { useAccounts } from '../hooks/useAccounts';
import { useExpenses } from '../hooks/useExpenses';
import { useLanguage } from '../context/LanguageContext';

interface AddExpenseProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
  defaultDate?: string; // YYYY-MM-DD, pre-fills the date field
}

type Step = 'amount' | 'allocation' | 'details';

export function AddExpense({ isOpen, onClose, onSaved, defaultDate }: AddExpenseProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';

  const { allocations } = useAllocations();
  const { accounts } = useAccounts();
  const { createExpense, suggestAllocation } = useExpenses();

  const activeAccounts = accounts.filter(a => !a.isArchived);

  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [selectedAllocationId, setSelectedAllocationId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  // Live category suggestion: `allocationTouched` guards against the debounced
  // suggestion overwriting a category the user picked by hand.
  const [allocationTouched, setAllocationTouched] = useState(false);
  const [suggestion, setSuggestion] = useState<{ allocationId: string; name: string; icon: string } | null>(null);

  const selectedAllocation = allocations.find(a => a.id === selectedAllocationId) ?? null;
  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null;

  // Default to the first active account once accounts load.
  useEffect(() => {
    if (!selectedAccountId && activeAccounts.length > 0) {
      setSelectedAccountId(activeAccounts[0].id);
    }
  }, [activeAccounts, selectedAccountId]);

  // Sync date when defaultDate changes (e.g. user navigates to a different month)
  useEffect(() => {
    if (defaultDate) setDate(defaultDate);
  }, [defaultDate]);

  // Debounced live category suggestion from the description (rules engine).
  // Applies only while the user hasn't manually chosen a category.
  useEffect(() => {
    if (allocationTouched) { setSuggestion(null); return; }
    const q = description.trim();
    if (!q) { setSuggestion(null); return; }
    const handle = setTimeout(async () => {
      const s = await suggestAllocation(q);
      if (s) {
        setSuggestion(s);
        setSelectedAllocationId(s.allocationId);
      } else {
        setSuggestion(null);
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, allocationTouched]);

  const reset = () => {
    setStep('amount');
    setAmount('');
    setSelectedAllocationId(null);
    setSelectedAccountId(null);
    setDescription('');
    setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
    setAllocationTouched(false);
    setSuggestion(null);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    const result = await createExpense({
      amount: parsed,
      description: description.trim(),
      allocationId: selectedAllocationId,
      accountId: selectedAccountId,
      date,
    });
    setSaving(false);
    if ('error' in result) {
      toast.error(result.error as string);
    } else {
      toast.success('Expense added!');
      onSaved?.();
      handleClose();
    }
  };

  const progressSteps: Step[] = ['amount', 'allocation', 'details'];
  const currentIdx = progressSteps.indexOf(step);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          <motion.div
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 60, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 bottom-4 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:w-full md:max-w-md bg-card border border-border rounded-3xl shadow-2xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                {step !== 'amount' && (
                  <button
                    onClick={() => setStep(progressSteps[currentIdx - 1] as Step)}
                    className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
                <h2 className="text-xl font-display">{t('addExpense.title')}</h2>
              </div>
              <button
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Progress bar */}
            <div className="flex gap-1.5 px-6 pt-4">
              {progressSteps.map((s, i) => (
                <div
                  key={s}
                  className={`flex-1 h-1 rounded-full transition-all duration-300 ${
                    i <= currentIdx ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            <div className="px-6 pb-6 pt-5">
              <AnimatePresence mode="wait">

                {/* Step 1: Amount */}
                {step === 'amount' && (
                  <motion.div
                    key="amount"
                    initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    <div>
                      <p className="text-sm text-muted-foreground mb-3">{t('addExpense.howMuch')}</p>
                      <div className="relative">
                        <Euro className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-muted-foreground" />
                        <input
                          type="number"
                          value={amount}
                          onChange={e => setAmount(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && amount && parseFloat(amount) > 0) setStep('allocation'); }}
                          placeholder="0.00"
                          autoFocus
                          min="0"
                          step="0.01"
                          className="w-full pl-14 pr-6 py-5 text-4xl font-display bg-background border-2 border-border rounded-2xl focus:outline-none focus:border-primary transition-colors"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => setStep('allocation')}
                      disabled={!amount || parseFloat(amount) <= 0}
                      className="w-full py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg transition-all"
                    >
                      {t('addExpense.continue')}
                    </button>
                  </motion.div>
                )}

                {/* Step 2: Allocation */}
                {step === 'allocation' && (
                  <motion.div
                    key="allocation"
                    initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    {/* Description first — drives the live category suggestion */}
                    <div>
                      <label className="text-sm text-muted-foreground mb-2 block">{t('addExpense.descriptionFirst')}</label>
                      <input
                        type="text"
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder={t('addExpense.notePlaceholder')}
                        autoFocus
                        className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:border-primary transition-colors text-sm"
                      />
                      {suggestion && !allocationTouched && selectedAllocationId === suggestion.allocationId && (
                        <p className="text-xs text-primary mt-2 flex items-center gap-1">
                          <span>{suggestion.icon}</span>
                          {t('addExpense.suggested')}: {suggestion.name}
                        </p>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground">{t('addExpense.whichCategory')}</p>
                    <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                      {allocations.map(a => (
                        <button
                          key={a.id}
                          onClick={() => { setAllocationTouched(true); setSelectedAllocationId(a.id); }}
                          className={`p-3 rounded-xl border-2 transition-all text-left ${
                            selectedAllocationId === a.id
                              ? 'border-primary bg-primary/5'
                              : 'border-border hover:border-primary/40'
                          }`}
                        >
                          <div className="text-2xl mb-1">{a.icon}</div>
                          <p className="text-sm font-medium truncate">{a.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{a.type}</p>
                        </button>
                      ))}
                      {/* Unassigned option */}
                      <button
                        onClick={() => { setAllocationTouched(true); setSelectedAllocationId(null); }}
                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                          selectedAllocationId === null
                            ? 'border-muted-foreground/50 bg-muted'
                            : 'border-border hover:border-muted-foreground/30'
                        }`}
                      >
                        <div className="text-2xl mb-1">❓</div>
                        <p className="text-sm font-medium">{t('addExpense.unassigned')}</p>
                        <p className="text-xs text-muted-foreground">{t('addExpense.noCategory')}</p>
                      </button>
                    </div>
                    <button
                      onClick={() => setStep('details')}
                      className="w-full py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all"
                    >
                      {t('addExpense.continue')}
                    </button>
                  </motion.div>
                )}

                {/* Step 3: Details + Summary */}
                {step === 'details' && (
                  <motion.div
                    key="details"
                    initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                  >
                    {activeAccounts.length > 0 && (
                      <div>
                        <label className="text-sm text-muted-foreground mb-2 block">{t('addExpense.account')}</label>
                        <select
                          value={selectedAccountId ?? ''}
                          onChange={e => setSelectedAccountId(e.target.value || null)}
                          className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:border-primary transition-colors text-sm"
                        >
                          {activeAccounts.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="text-sm text-muted-foreground mb-2 block">{t('addExpense.date')}</label>
                      <input
                        type="date"
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="w-full px-4 py-3 bg-background border border-border rounded-xl focus:outline-none focus:border-primary transition-colors text-sm"
                      />
                    </div>

                    {/* Summary card */}
                    <div className="bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/10 rounded-2xl p-4 space-y-2.5">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">{t('addExpense.summary')}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('addExpense.amount')}</span>
                        <span className="text-2xl font-display text-primary">€{parseFloat(amount).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('addExpense.category')}</span>
                        <div className="flex items-center gap-2">
                          <span>{selectedAllocation?.icon ?? '❓'}</span>
                          <span className="text-sm font-medium">{selectedAllocation?.name ?? t('addExpense.unassigned')}</span>
                        </div>
                      </div>
                      {selectedAccount && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{t('addExpense.account')}</span>
                          <span className="text-sm font-medium truncate ml-4">{selectedAccount.name}</span>
                        </div>
                      )}
                      {description && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">{t('addExpense.note')}</span>
                          <span className="text-sm font-medium truncate ml-4">{description}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">{t('addExpense.date')}</span>
                        <span className="text-sm font-medium">{new Date(date + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      </div>
                    </div>

                    <button
                      onClick={handleSubmit}
                      disabled={saving}
                      className="w-full py-4 bg-gradient-to-r from-primary to-secondary text-white rounded-xl font-display hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                      {saving ? 'Saving...' : t('addExpense.addExpense')}
                    </button>
                  </motion.div>
                )}

              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
