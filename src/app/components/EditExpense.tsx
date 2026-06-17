import { useState, useEffect } from 'react';
import { X, Check, Euro, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { Expense, AttributionPayload } from '../hooks/useExpenses';
import type { Allocation } from '../hooks/useAllocations';
import { useHousehold } from '../hooks/useHousehold';

interface EditExpenseProps {
  isOpen: boolean;
  expense: Expense | null;
  allocations: Allocation[];
  onClose: () => void;
  onSave: (payload: { amount: number; description: string; allocationId: string | null; date: string }) =>
    Promise<{ error?: string } | { expense: Expense }>;
  onSaveAttribution?: (payload: AttributionPayload) => Promise<{ error?: string } | { expense: Expense }>;
}

export function EditExpense({ isOpen, expense, allocations, onClose, onSave, onSaveAttribution }: EditExpenseProps) {
  const { t } = useTranslation();
  const { household } = useHousehold();
  const members = household?.members ?? [];
  const showAttribution = members.length > 1;

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [allocationId, setAllocationId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  // Attribution (Epic H3)
  const [scope, setScope] = useState<'personal' | 'shared'>('personal');
  const [payerUserId, setPayerUserId] = useState('');
  const [splitMode, setSplitMode] = useState<'model' | 'custom'>('model');
  const [customShares, setCustomShares] = useState<Record<string, string>>({});

  // Sync form when the target expense changes
  useEffect(() => {
    if (!expense) return;
    setAmount(String(expense.amount));
    setDescription(expense.description ?? '');
    setAllocationId(expense.allocationId);
    setDate(expense.date.slice(0, 10));
    setScope((expense.scope as 'personal' | 'shared') ?? 'personal');
    setPayerUserId(expense.payerUserId ?? '');
    setSplitMode('model');
    setCustomShares(Object.fromEntries((expense.shares ?? []).map(s => [s.userId, String(s.amount)])));
  }, [expense]);

  // Prefill custom inputs with an equal split when switching to custom mode empty.
  const startCustom = () => {
    setSplitMode('custom');
    const parsed = parseFloat(amount) || 0;
    if (Object.keys(customShares).length === 0 && members.length > 0) {
      const each = (parsed / members.length).toFixed(2);
      setCustomShares(Object.fromEntries(members.map(m => [m.userId, each])));
    }
  };

  const customTotal = members.reduce((s, m) => s + (parseFloat(customShares[m.userId] ?? '0') || 0), 0);

  const handleSubmit = async () => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) { toast.error(t('editExpense.invalidAmount')); return; }

    // Validate a custom split before saving anything.
    if (showAttribution && scope === 'shared' && splitMode === 'custom') {
      if (Math.abs(customTotal - parsed) > 0.005) {
        toast.error(t('editExpense.splitMustSum', { total: customTotal.toFixed(2), amount: parsed.toFixed(2) }));
        return;
      }
    }

    setSaving(true);
    const result = await onSave({ amount: parsed, description: description.trim(), allocationId, date });
    if ('error' in result && result.error) { setSaving(false); toast.error(result.error); return; }

    if (showAttribution && onSaveAttribution) {
      const payload: AttributionPayload = { scope, payerUserId: payerUserId || undefined };
      if (scope === 'shared' && splitMode === 'custom') {
        payload.shares = members.map(m => ({ userId: m.userId, amount: parseFloat(customShares[m.userId] ?? '0') || 0 }));
      }
      const attr = await onSaveAttribution(payload);
      if ('error' in attr && attr.error) { setSaving(false); toast.error(attr.error); return; }
    }

    setSaving(false);
    toast.success(t('editExpense.saved'));
    onClose();
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

              {/* Attribution (Epic H3) — only inside a household */}
              {showAttribution && (
                <div className="space-y-3 pt-1 border-t border-border">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground pt-3">{t('editExpense.attribution')}</p>

                  {/* Scope */}
                  <div className="grid grid-cols-2 gap-2">
                    {(['personal', 'shared'] as const).map(s => (
                      <button
                        key={s}
                        onClick={() => setScope(s)}
                        className={`py-2 rounded-xl border-2 text-sm transition-all ${
                          scope === s ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                        }`}
                      >
                        {t(`editExpense.scope_${s}`)}
                      </button>
                    ))}
                  </div>

                  {/* Payer */}
                  <div>
                    <label className="text-sm text-muted-foreground mb-1.5 block">{t('editExpense.payer')}</label>
                    <select
                      value={payerUserId}
                      onChange={e => setPayerUserId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-background border border-border rounded-xl outline-none focus:border-primary text-sm"
                    >
                      {members.map(m => <option key={m.userId} value={m.userId}>{m.name ?? m.email}</option>)}
                    </select>
                  </div>

                  {/* Distribution (shared only) */}
                  {scope === 'shared' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setSplitMode('model')}
                          className={`py-2 rounded-xl border-2 text-sm transition-all ${
                            splitMode === 'model' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                          }`}
                        >
                          {t('editExpense.splitModel')}
                        </button>
                        <button
                          onClick={startCustom}
                          className={`py-2 rounded-xl border-2 text-sm transition-all ${
                            splitMode === 'custom' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                          }`}
                        >
                          {t('editExpense.splitCustom')}
                        </button>
                      </div>
                      {splitMode === 'custom' && (
                        <div className="space-y-2">
                          {members.map(m => (
                            <div key={m.userId} className="flex items-center gap-2">
                              <span className="text-sm flex-1 truncate">{m.name ?? m.email}</span>
                              <div className="relative w-28">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                                <input
                                  type="number" min="0" step="0.01"
                                  value={customShares[m.userId] ?? ''}
                                  onChange={e => setCustomShares(prev => ({ ...prev, [m.userId]: e.target.value }))}
                                  className="w-full pl-7 pr-2 py-1.5 bg-background border border-border rounded-lg outline-none focus:border-primary text-sm"
                                />
                              </div>
                            </div>
                          ))}
                          <p className={`text-xs text-right ${Math.abs(customTotal - (parseFloat(amount) || 0)) > 0.005 ? 'text-red-500' : 'text-muted-foreground'}`}>
                            {t('editExpense.splitTotal', { total: customTotal.toFixed(2), amount: (parseFloat(amount) || 0).toFixed(2) })}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

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
