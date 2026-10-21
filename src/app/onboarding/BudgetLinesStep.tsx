import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAllocations, type Allocation } from '../hooks/useAllocations';
import { useDebts } from '../hooks/useDebts';
import { renderAllocationIcon } from '../components/shared/AllocationIcon';
import { useMoney } from './useMoney';

type LineType = 'fixed' | 'flexible';

const SUGGESTIONS: Record<LineType, { key: string; icon: string }[]> = {
  fixed: [
    { key: 'housing', icon: '🏠' },
    { key: 'utilities', icon: '💡' },
    { key: 'internet', icon: '📱' },
    { key: 'insurance', icon: '🛡️' },
    { key: 'subscriptions', icon: '📺' },
    { key: 'school', icon: '🎓' },
  ],
  flexible: [
    { key: 'groceries', icon: '🛒' },
    { key: 'transport', icon: '🚗' },
    { key: 'leisure', icon: '🎮' },
  ],
};

// Fixed (step 6) and variable (step 7) budget lines. Suggestions are shown
// with an empty amount and only become a real Allocation once an amount is
// entered, so walking past this step creates nothing.
// A mortgage registered as a debt already has its (locked) budget line, so
// the rent/mortgage suggestion is left out instead of counting it twice.
export function BudgetLinesStep({ type }: { type: LineType }) {
  const { t } = useTranslation();
  const { fmt, currency } = useMoney();
  const {
    allocations, monthlyIncome, totalAllocated, loading,
    createAllocation, updateAllocation, deleteAllocation,
  } = useAllocations();
  const { debts } = useDebts();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [adding, setAdding] = useState(false);

  const hasMortgage = debts.some(d => d.kind === 'mortgage' && d.status === 'active');
  const suggestedName = (key: string) => t(`onboarding.lines.suggested.${key}`);

  // The signup's empty default lines ("Fixed Expenses"…) only show once used.
  const lines = allocations
    .filter(a => a.type === type && !(a.isDefault && a.allocatedAmount === 0))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const pending = SUGGESTIONS[type]
    .filter(s => !(type === 'fixed' && s.key === 'housing' && hasMortgage))
    .filter(s => !allocations.some(a => a.type === type && a.name === suggestedName(s.key)));

  const debtLines = allocations.filter(a => a.type === 'debt').reduce((s, a) => s + a.allocatedAmount, 0);
  const leftover = monthlyIncome - totalAllocated;

  const saveExisting = async (a: Allocation, value: string) => {
    const amount = parseFloat(value) || 0;
    if (amount === a.allocatedAmount) return;
    const result = await updateAllocation(a.id, { allocatedAmount: amount });
    if ('error' in result) toast.error(result.error as string);
  };

  const saveSuggestion = async (s: { key: string; icon: string }, value: string) => {
    const amount = parseFloat(value) || 0;
    if (amount <= 0) return;
    const result = await createAllocation({ name: suggestedName(s.key), icon: s.icon, type, allocatedAmount: amount });
    if ('error' in result) toast.error(result.error as string);
  };

  const handleAddCustom = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    const result = await createAllocation({ name: newName.trim(), icon: '💰', type, allocatedAmount: parseFloat(newAmount) || 0 });
    setAdding(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    setNewName(''); setNewAmount(''); setShowAdd(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const amountInput = (defaultValue: string, onSave: (v: string) => void) => (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">{currency}</span>
      <input
        type="number"
        inputMode="decimal"
        defaultValue={defaultValue}
        onBlur={e => onSave(e.target.value)}
        placeholder="0"
        className="w-28 pl-6 pr-2 py-2 border border-border rounded-lg bg-background outline-none focus:border-primary text-sm text-right"
      />
    </div>
  );

  return (
    <div>
      <div className="bg-card border border-border rounded-2xl p-5 mb-6 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">{t('onboarding.lines.income')}</p>
          <p className="text-2xl font-display">{fmt(monthlyIncome)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('onboarding.lines.debts')}</p>
          <p className="text-2xl font-display">{fmt(debtLines)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">{t('onboarding.lines.leftover')}</p>
          <p className={`text-2xl font-display ${leftover < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{fmt(leftover)}</p>
        </div>
      </div>

      {type === 'fixed' && hasMortgage && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 mb-6 flex gap-3 text-sm text-amber-800 dark:text-amber-400">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{t('onboarding.lines.fixed.mortgageNote')}</div>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {lines.map(a => (
          <div key={a.id} className="p-4 rounded-xl border border-border bg-card flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">{renderAllocationIcon(a.icon)}</span>
              <p className="text-sm font-medium truncate">{a.name}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {amountInput(a.allocatedAmount ? String(a.allocatedAmount) : '', v => saveExisting(a, v))}
              {!a.isDefault && (
                <button onClick={() => deleteAllocation(a.id)} className="text-muted-foreground hover:text-destructive" title={t('onboarding.lines.remove')}>
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
        {pending.map(s => (
          <div key={s.key} className="p-4 rounded-xl border border-dashed border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">{renderAllocationIcon(s.icon)}</span>
              <p className="text-sm text-muted-foreground truncate">{suggestedName(s.key)}</p>
            </div>
            {amountInput('', v => saveSuggestion(s, v))}
          </div>
        ))}
      </div>

      {showAdd ? (
        <div className="p-4 rounded-xl border border-border flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={t('onboarding.lines.namePlaceholder')}
            className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 bg-background outline-none focus:border-primary text-sm"
          />
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">{currency}</span>
            <input
              type="number"
              inputMode="decimal"
              value={newAmount}
              onChange={e => setNewAmount(e.target.value)}
              placeholder="0"
              className="w-24 pl-6 pr-2 py-2 border border-border rounded-lg bg-background outline-none focus:border-primary text-sm text-right"
            />
          </div>
          <button
            onClick={handleAddCustom}
            disabled={adding || !newName.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
          >
            {adding && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('onboarding.lines.addAction')}
          </button>
          <button onClick={() => setShowAdd(false)} className="p-2 text-muted-foreground hover:text-foreground" title={t('onboarding.cancel')}>
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-4 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-secondary hover:border-secondary transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" /> {t('onboarding.lines.add')}
        </button>
      )}
    </div>
  );
}
