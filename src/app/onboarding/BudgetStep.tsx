import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Lock, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAllocations } from '../hooks/useAllocations';
import { useDebts, type DebtKind } from '../hooks/useDebts';
import { IconPicker, renderAllocationIcon } from '../components/shared/AllocationIcon';

const CONSUMER_KINDS = new Set<DebtKind>(['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan']);

const SUGGESTED_CATEGORIES = [
  { key: 'housing', icon: '🏠', type: 'fixed' },
  { key: 'groceries', icon: '🛒', type: 'flexible' },
  { key: 'transport', icon: '🚗', type: 'flexible' },
  { key: 'utilities', icon: '💡', type: 'fixed' },
  { key: 'leisure', icon: '🎮', type: 'flexible' },
] as const;

const TYPE_COLORS: Record<string, string> = {
  generosity: 'bg-rose-500',
  debt: 'bg-orange-500',
  fixed: 'bg-blue-500',
  flexible: 'bg-amber-500',
  plan: 'bg-violet-500',
};

// Método Ruta rules applied here:
// R1 — generosity is the first line, locked against deletion, can go to 0.
// R4.2 — while in Estado A (active consumer debt), "plan" (savings/investment
//        goal) categories are disabled: all surplus goes to the debt attack.
// R2 — live hierarchy warning when the budget doesn't fit: trim flexible
//      first, then plan, never generosity; a >=20% gap is structural, not a
//      habit to nickel-and-dime.
export function BudgetStep() {
  const { t } = useTranslation();
  const {
    allocations, monthlyIncome, totalAllocated, unallocated, loading: allocLoading,
    createAllocation, updateAllocation, deleteAllocation,
  } = useAllocations();
  const { debts, loading: debtsLoading } = useDebts();

  const seededRef = useRef(false);
  const [seeding, setSeeding] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('💰');
  const [newType, setNewType] = useState<'fixed' | 'flexible' | 'plan'>('flexible');
  const [newAmount, setNewAmount] = useState('');
  const [adding, setAdding] = useState(false);

  const activeConsumerDebts = debts.filter(d => d.status === 'active' && CONSUMER_KINDS.has(d.kind) && d.currentBalance > 0);
  const inDebtState = activeConsumerDebts.length > 0;

  // One-time seed: the generosity line, one Allocation per active debt, and a
  // starter set of category suggestions — only the first time this step is
  // reached with nothing custom configured yet.
  useEffect(() => {
    if (seededRef.current || allocLoading || debtsLoading) return;
    seededRef.current = true;

    const run = async () => {
      const hasGenerosity = allocations.some(a => a.type === 'generosity');
      if (!hasGenerosity) {
        const suggested = Math.round(monthlyIncome * 0.05);
        await createAllocation({ name: t('onboarding.budget.generosityName'), icon: '❤️', type: 'generosity', allocatedAmount: suggested });
      }

      const linkedDebtIds = new Set(allocations.filter(a => a.type === 'debt').map(a => a.debtId));
      for (const debt of debts.filter(d => d.status === 'active')) {
        if (linkedDebtIds.has(debt.id)) continue;
        await createAllocation({ name: debt.name, icon: '🔒', type: 'debt', debtId: debt.id });
      }

      const hasCustom = allocations.some(a => !a.isDefault && a.type !== 'generosity' && a.type !== 'debt');
      if (!hasCustom) {
        const hasMortgage = debts.some(d => d.kind === 'mortgage' && d.status === 'active');
        for (const cat of SUGGESTED_CATEGORIES) {
          if (cat.key === 'housing' && hasMortgage) continue; // already represented as a debt line
          await createAllocation({ name: t(`onboarding.budget.suggested.${cat.key}`), icon: cat.icon, type: cat.type, allocatedAmount: 0 });
        }
      }

      setSeeding(false);
    };
    run();
  }, [allocLoading, debtsLoading]);

  const handleAddCategory = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    const result = await createAllocation({ name: newName.trim(), icon: newIcon, type: newType, allocatedAmount: parseFloat(newAmount) || 0 });
    setAdding(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    setNewName(''); setNewAmount(''); setNewIcon('💰'); setNewType('flexible'); setShowAdd(false);
  };

  const handleAmountChange = (id: string, value: string) => {
    updateAllocation(id, { allocatedAmount: parseFloat(value) || 0 });
  };

  const overflow = totalAllocated - monthlyIncome;
  const overflowPct = monthlyIncome > 0 ? (overflow / monthlyIncome) * 100 : 0;

  if (seeding) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const rows = [...allocations].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div>
      <div className="bg-muted/30 rounded-xl p-4 border border-border mb-6">
        <div className="flex justify-between items-end mb-2">
          <div>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('onboarding.budget.totalIncome')}</span>
            <div className="text-xl font-display">€{monthlyIncome.toLocaleString()}</div>
          </div>
          <div className="text-right">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('onboarding.budget.unallocated')}</span>
            <div className={`text-xl font-display ${overflow > 0 ? 'text-destructive' : 'text-secondary'}`}>€{unallocated.toLocaleString()}</div>
          </div>
        </div>
        <div className="w-full h-3 rounded-full overflow-hidden flex bg-muted">
          {rows.map(a => monthlyIncome > 0 && (
            <div key={a.id} className={TYPE_COLORS[a.type] ?? 'bg-muted-foreground'} style={{ width: `${Math.min(100, (a.allocatedAmount / monthlyIncome) * 100)}%` }} />
          ))}
        </div>
      </div>

      {overflow > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-400">
            {overflowPct >= 20 ? t('onboarding.budget.overflowStructural') : t('onboarding.budget.overflowHabit')}
          </p>
        </div>
      )}

      {inDebtState && (
        <div className="mb-6 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t('onboarding.budget.debtStateNotice')}
        </div>
      )}

      <div className="space-y-2 mb-4">
        {rows.map(a => {
          const isGenerosity = a.type === 'generosity';
          const isDebt = a.type === 'debt';
          return (
            <div key={a.id} className="p-4 rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    {isDebt ? <Lock className="w-4 h-4 text-muted-foreground" /> : renderAllocationIcon(a.icon)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {isGenerosity
                        ? t('onboarding.budget.requiredBadge')
                        : isDebt
                        ? t('onboarding.budget.debtBadge')
                        : t(`allocation.${a.type}Desc`)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isDebt ? (
                    <span className="font-display text-sm">€{a.allocatedAmount.toLocaleString()}</span>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">€</span>
                      <input
                        type="number" inputMode="decimal" defaultValue={a.allocatedAmount}
                        onBlur={e => handleAmountChange(a.id, e.target.value)}
                        className="w-24 pl-6 pr-2 py-1.5 border border-border rounded-lg bg-background outline-none focus:border-secondary text-sm text-right"
                      />
                    </div>
                  )}
                  {!isGenerosity && !isDebt && (
                    <button onClick={() => deleteAllocation(a.id)} className="text-muted-foreground hover:text-destructive">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd ? (
        <div className="p-4 rounded-xl border border-border space-y-3 mb-4">
          <input
            autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            placeholder={t('allocation.name') as string}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background outline-none focus:border-secondary text-sm"
          />
          <div className="grid grid-cols-3 gap-2">
            {(['fixed', 'flexible', 'plan'] as const).map(ty => {
              const disabled = ty === 'plan' && inDebtState;
              return (
                <button
                  key={ty}
                  disabled={disabled}
                  onClick={() => setNewType(ty)}
                  title={disabled ? t('onboarding.budget.planDisabled') as string : undefined}
                  className={`py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-40 ${newType === ty ? 'border-secondary bg-secondary/5 text-secondary' : 'border-border hover:bg-muted'}`}
                >
                  {ty === 'plan' ? t('allocation.planType') : t(`allocation.${ty}`)}
                </button>
              );
            })}
          </div>
          <IconPicker value={newIcon} onChange={setNewIcon} />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
            <input
              type="number" inputMode="decimal" value={newAmount} onChange={e => setNewAmount(e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-border rounded-lg bg-background outline-none focus:border-secondary text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAddCategory}
              disabled={adding || !newName.trim()}
              className="flex-1 py-2.5 bg-foreground text-background rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {adding && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('allocation.addAllocation')}
            </button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground">
              {t('onboarding.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="w-full py-4 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:text-secondary hover:border-secondary transition-colors flex items-center justify-center gap-2 mb-4"
        >
          <Plus className="w-3.5 h-3.5" /> {t('allocation.addAllocation')}
        </button>
      )}
    </div>
  );
}
