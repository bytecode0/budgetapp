import { useState, useEffect, useRef, useCallback } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useTranslation } from 'react-i18next';
import {
  Lightbulb, CheckCircle2, Plus, Trash2, Scale,
  Pencil, X, Check, Loader2, CalendarCheck, GripVertical, Repeat, Wallet, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAllocations } from '../hooks/useAllocations';
import { usePlans } from '../hooks/usePlans';
import { useIncome } from '../hooks/useIncome';
import { useMonthlyBudget, useMonthlyReview } from '../hooks/useMonthlyBudget';
import { AddExpense } from './AddExpense';
import { AddIncome } from './AddIncome';
import { RecurringManager } from './RecurringManager';
import { BudgetSuggestions } from './BudgetSuggestions';
import { useLanguage } from '../context/LanguageContext';
import { useMonth, monthLabel } from '../context/MonthContext';
import { IconPicker, renderAllocationIcon } from './shared/AllocationIcon';
import { useMoney } from '../onboarding/useMoney';

// The types a person can pick for a line. "debt" lines are kept in step by the
// server and "generosity" is the budget's one fixed first line (LPBETA-10):
// neither can be picked nor changed here.
const TYPE_OPTIONS = ['fixed', 'flexible', 'plan'] as const;
const GENEROSITY_TYPE = 'generosity';

function normalizeType(type: string): string {
  if (type === 'essential') return 'fixed';
  if (type === 'investment') return 'flexible';
  return type;
}

// Each kind of line has one series colour (Remanso chart tokens, defined for
// light and dark in theme.css) and one label: the legend always pairs both.
const KINDS = ['fixed', 'flexible', 'plan', 'generosity', 'debt'] as const;
type Kind = typeof KINDS[number];
const KIND_COLOR: Record<Kind, string> = {
  fixed: 'var(--chart-1)',
  flexible: 'var(--chart-4)',
  plan: 'var(--chart-3)',
  generosity: 'var(--chart-2)',
  debt: 'var(--chart-5)',
};
const KIND_LABEL: Record<Kind, string> = {
  fixed: 'allocation.fixed',
  flexible: 'allocation.flexible',
  plan: 'allocation.plans',
  generosity: 'allocation.generosity',
  debt: 'allocation.debt',
};
const FREE_COLOR = 'var(--line)';

function kindOf(type: string): Kind {
  const t = normalizeType(type);
  return (KINDS as readonly string[]).includes(t) ? t as Kind : 'fixed';
}

// ── Drag-and-drop ────────────────────────────────────────────────────────────

const DRAG_TYPE = 'ALLOCATION_ROW';

interface DragItem { id: string; index: number }

function DraggableRow({
  id, index, moveRow, canMove, onDragEnd, children,
}: {
  id: string;
  index: number;
  moveRow: (from: number, to: number) => void;
  /** False when the move would shift a line that must stay put (Generosity). */
  canMove: (from: number, to: number) => boolean;
  onDragEnd: () => void;
  children: (handleRef: React.RefObject<HTMLDivElement>) => React.ReactNode;
}) {
  const rowRef  = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: DRAG_TYPE,
    item: () => ({ id, index }),
    collect: monitor => ({ isDragging: monitor.isDragging() }),
    end: () => onDragEnd(),
  });

  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>({
    accept: DRAG_TYPE,
    collect: monitor => ({ isOver: monitor.isOver() }),
    hover(draggedItem) {
      if (draggedItem.index === index) return;
      if (!canMove(draggedItem.index, index)) return;
      moveRow(draggedItem.index, index);
      draggedItem.index = index;
    },
  });

  drop(rowRef);
  drag(handleRef);

  return (
    <div
      ref={rowRef}
      className={`transition-opacity rounded-2xl ${isDragging ? 'opacity-40' : 'opacity-100'} ${isOver ? 'ring-2 ring-primary/20' : ''}`}
    >
      {children(handleRef)}
    </div>
  );
}

interface LocalAllocation {
  id: string; name: string; icon: string; type: string;
  lifePlanId: string | null;
  allocatedAmount: number; actualAmount: number; isDefault: boolean;
  dirty: boolean;
  // Track what changed so saves route correctly: amounts are per-month
  // (MonthlyBudget), while name/icon/type/lifePlan are global attributes of the
  // category (Allocation).
  amountDirty: boolean; metaDirty: boolean;
}

export function AllocationFlow() {
  const { t } = useTranslation();
  const { fmt, currency } = useMoney();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';

  const {
    allocations: rawAllocations, monthlyIncome: baseIncome, ownMonthlyIncome, isCouple, loading,
    updateIncome, createAllocation, updateAllocation, deleteAllocation, reorderAllocations, fetchAllocations,
  } = useAllocations();

  const [showBudgetSuggestions, setShowBudgetSuggestions] = useState(false);

  const { plans: rawPlans, loading: plansLoading } = usePlans();

  const { selectedMonth, isCurrentMonth, isFutureMonth } = useMonth();
  // Per-month budget data (MonthlyBudget). The GET endpoint returns this month's
  // overrides, or the global allocation amounts as a fallback flagged saved:false.
  const {
    budgets: monthlyBudgets, hiddenCommitted, loading: monthlyLoading,
    saving: savingMonthlyBudget, isSaved: isBudgetSaved, saveBudgets, fetchBudgets,
  } = useMonthlyBudget(selectedMonth);
  const { review: monthReview } = useMonthlyReview(selectedMonth);
  const { incomes, totalIncome, fetchIncomes } = useIncome(selectedMonth);
  // Effective income for the month = sum of recorded income transactions,
  // falling back to the planned baseline (UserSettings.monthlyIncome) when none
  // exist yet. This makes allocation math dynamic once real income is tracked.
  const hasRecordedIncome = incomes.length > 0;
  const monthlyIncome = hasRecordedIncome ? totalIncome : baseIncome;

  // ── Local allocation state ──────────────────────────────
  const [local, setLocal] = useState<LocalAllocation[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Income editing ──────────────────────────────────────
  const [editingIncome, setEditingIncome] = useState(false);
  const [incomeInput, setIncomeInput]     = useState('');

  // ── Add allocation modal ────────────────────────────────
  const [showAdd, setShowAdd]         = useState(false);
  const [newName, setNewName]         = useState('');
  const [newIcon, setNewIcon]         = useState('💰');
  const [newType, setNewType]         = useState('flexible');
  const [newLifePlanId, setNewLifePlanId] = useState<string>('');
  const [adding, setAdding]           = useState(false);

  // ── Inline name edit ────────────────────────────────────
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [nameInput, setNameInput]         = useState('');

  // Seed the editable rows from the category list (metadata) merged with the
  // selected month's budget amount. Re-seeds when the month changes, so each
  // month shows its own budget (or the default fallback). Category metadata
  // (name/icon/type/lifePlan) is always global.
  useEffect(() => {
    if (monthlyLoading) return;
    const amountByAlloc = new Map(monthlyBudgets.map(b => [b.allocationId, b.allocatedAmount]));
    setLocal(rawAllocations.map(a => ({
      id: a.id, name: a.name, icon: a.icon, type: a.type,
      lifePlanId: a.lifePlanId ?? null,
      allocatedAmount: amountByAlloc.has(a.id) ? amountByAlloc.get(a.id)! : a.allocatedAmount,
      actualAmount: a.actualAmount,
      isDefault: a.isDefault,
      dirty: false, amountDirty: false, metaDirty: false,
    })));
  }, [rawAllocations, monthlyBudgets, monthlyLoading]);

  // ── Derived numbers ─────────────────────────────────────
  // The partner's private debt lines aren't listed but are part of the budget.
  const totalAllocated = local.reduce((s, a) => s + a.allocatedAmount, 0) + hiddenCommitted;
  const planAllocTotal = local
    .filter(a => normalizeType(a.type) === 'plan')
    .reduce((s, a) => s + a.allocatedAmount, 0);
  const freeAmount  = monthlyIncome - totalAllocated;
  const isOver      = freeAmount < -0.5;
  const isBalanced  = Math.abs(freeAmount) <= 0.5;

  // ── Handlers — allocations ──────────────────────────────
  const updateLocal = (id: string, patch: Partial<LocalAllocation>) =>
    setLocal(prev => prev.map(a => {
      if (a.id !== id) return a;
      const touchesAmount = 'allocatedAmount' in patch;
      const touchesMeta = 'name' in patch || 'icon' in patch || 'type' in patch || 'lifePlanId' in patch;
      return {
        ...a, ...patch, dirty: true,
        amountDirty: a.amountDirty || touchesAmount,
        metaDirty: a.metaDirty || touchesMeta,
      };
    }));

  // "Save as default": writes amounts (and any structural edits) onto the global
  // Allocation template. Months WITHOUT their own budget then reflect this.
  const handleSaveAllocations = async () => {
    setSaving(true);
    const dirty = local.filter(a => a.dirty);
    const results = await Promise.all(
      // The amount only when it was edited: an untouched amount sent back
      // would overwrite a derived one (the Generosity share, LPBETA-10).
      dirty.map(a => updateAllocation(a.id, {
        name: a.name, icon: a.icon, type: a.type, lifePlanId: a.lifePlanId,
        ...(a.amountDirty && { allocatedAmount: a.allocatedAmount, month: selectedMonth }),
      }))
    );
    setSaving(false);
    if (results.some(r => r && 'error' in r && r.error)) {
      toast.error(t('allocation.saveFailed'));
    } else {
      setLocal(prev => prev.map(a => ({ ...a, dirty: false, amountDirty: false, metaDirty: false })));
      await fetchBudgets(); // refresh so the current month reflects the new default
      toast.success(t('allocation.defaultSaved'));
    }
  };

  const handleSaveIncome = async () => {
    const amount = parseFloat(incomeInput.replace(/,/g, ''));
    if (isNaN(amount) || amount < 0) { toast.error(t('allocation.invalidAmount')); return; }
    const result = await updateIncome(amount);
    if ('error' in result && result.error) toast.error(result.error as string);
    else { toast.success(t('allocation.incomeUpdated')); setEditingIncome(false); }
  };

  const handleAddAllocation = async () => {
    if (!newName.trim()) { toast.error(t('allocation.nameRequired')); return; }
    if (newType === 'plan' && !newLifePlanId) { toast.error(t('allocation.lifePlanRequired')); return; }
    setAdding(true);
    const result = await createAllocation({
      name: newName.trim(), icon: newIcon, type: newType,
      lifePlanId: newType === 'plan' ? newLifePlanId : null,
    });
    setAdding(false);
    if ('error' in result && result.error) toast.error(result.error as string);
    else {
      toast.success(t('allocation.addedOk'));
      setShowAdd(false); setNewName(''); setNewIcon('💰'); setNewType('flexible'); setNewLifePlanId('');
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteAllocation(id);
    if ('error' in result && result.error) toast.error(result.error as string);
    else toast.success(t('allocation.removedOk'));
  };

  const commitEditName = (id: string) => {
    if (nameInput.trim()) updateLocal(id, { name: nameInput.trim() });
    setEditingNameId(null);
  };

  const hasDirtyAllocations = local.some(a => a.dirty);

  // Keep a ref in sync so handleDragEnd always reads latest state
  const localRef = useRef(local);
  localRef.current = local;

  const moveRow = useCallback((from: number, to: number) => {
    setLocal(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // The Generosity line is the budget's first line and stays where it is: no
  // move may pass over it (Método Ruta R1, server/lib/generosity.ts).
  const canMove = useCallback((from: number, to: number) => {
    const g = localRef.current.findIndex(a => a.type === GENEROSITY_TYPE);
    return g === -1 || g < Math.min(from, to) || g > Math.max(from, to);
  }, []);

  const handleDragEnd = useCallback(() => {
    const order = localRef.current.map((item, index) => ({ id: item.id, sortOrder: index }));
    reorderAllocations(order);
  }, [reorderAllocations]);

  const expenseDefaultDate = isCurrentMonth
    ? new Date().toISOString().slice(0, 10)
    : (() => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      })();

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);
  const [showAddIncome, setShowAddIncome] = useState(false);

  // "Save for {month}": the primary action. Structural edits (name/icon/type/
  // lifePlan) are global, so they go to the Allocation. Amounts become per-month
  // overrides — but only for the categories the user actually changed, so the
  // rest keep following the default template.
  const handleSaveMonthlyBudget = async () => {
    const metaDirty = local.filter(a => a.metaDirty);
    const metaResults = await Promise.all(
      metaDirty.map(a => updateAllocation(a.id, {
        name: a.name, icon: a.icon, type: a.type, lifePlanId: a.lifePlanId,
      }))
    );

    const amountEntries = local
      .filter(a => a.amountDirty)
      .map(a => ({ allocationId: a.id, allocatedAmount: a.allocatedAmount }));
    const budgetResult = amountEntries.length > 0
      ? await saveBudgets(amountEntries)
      : {};

    const metaFailed = metaResults.some(r => r && 'error' in r && r.error);
    if (metaFailed || ('error' in budgetResult && budgetResult.error)) {
      toast.error(t('allocation.saveFailed'));
      return;
    }
    setLocal(prev => prev.map(a => ({ ...a, dirty: false, amountDirty: false, metaDirty: false })));
    toast.success(t('allocation.budgetSnapshotSaved', { month: monthLabel(selectedMonth, locale) }));
  };

  if (loading || plansLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const freePct  = monthlyIncome > 0 ? Math.max(0, (freeAmount / monthlyIncome) * 100) : 0;
  const pctOf    = (amount: number) => monthlyIncome > 0 ? Math.round((amount / monthlyIncome) * 100) : 0;
  const isPlanningMonth = isCurrentMonth || isFutureMonth;

  // Breakdown bar: one segment per line (partner's private lines as one, in the
  // debt colour), then what is left free. The legend lists only the kinds present.
  const segments = [
    ...local.filter(a => a.allocatedAmount > 0).map(a => ({
      key: a.id, label: a.name, amount: a.allocatedAmount, kind: kindOf(a.type),
    })),
    ...(hiddenCommitted > 0
      ? [{ key: 'hidden', label: t('allocation.partnerPrivateCommitments'), amount: hiddenCommitted, kind: 'debt' as Kind }]
      : []),
  ];
  const kindsPresent = KINDS.filter(k => segments.some(s => s.kind === k));
  const barLabel = [
    ...kindsPresent.map(k => `${t(KIND_LABEL[k])}: ${fmt(segments.filter(s => s.kind === k).reduce((sum, s) => sum + s.amount, 0))}`),
    ...(freePct > 0.5 ? [`${t('allocation.freeCash')}: ${fmt(freeAmount)}`] : []),
  ].join(', ');

  const monthName = monthLabel(selectedMonth, locale);
  const net = monthlyIncome - (monthReview?.totalActual ?? 0);

  return (
    <DndProvider backend={HTML5Backend}>
    <div className="space-y-6 pb-8">
      <motion.div
        initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}
        className="flex flex-wrap items-start justify-between gap-4"
      >
        <div className="space-y-2 min-w-0">
          <h1 className="text-4xl tracking-tight font-display">{t('allocation.title')}</h1>
          <p className="text-muted-foreground">{t('allocation.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowRecurring(true)}
          className="h-11 px-4 border border-line-strong rounded-xl hover:bg-muted transition-colors text-sm font-medium flex items-center gap-2 shrink-0"
        >
          <Repeat className="w-4 h-4" /> {t('recurring.manageButton')}
        </button>
      </motion.div>

      {/* ── Income: the one big number, then how much of it is assigned ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-6"
      >
        {/* Month + add expense */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="inline-flex items-center gap-2 bg-surface-sunk rounded-full px-3 py-1.5 text-sm">
            <span className="font-medium capitalize">{monthName}</span>
            {isFutureMonth && <span className="text-xs text-muted-foreground">{t('monthlyReview.nextMonth')}</span>}
          </p>
          <button
            onClick={() => setShowAddExpense(true)}
            className="h-11 px-4 border border-line-strong rounded-xl hover:bg-muted transition-colors text-sm font-medium flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {isCurrentMonth
              ? t('allocation.addExpense')
              : t('allocation.addToMonth', { month: monthName.split(' ')[0] })}
          </button>
        </div>

        {/* Income amount */}
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('allocation.monthlyIncome')}</p>
          {hasRecordedIncome ? (
            /* Dynamic: sum of this month's recorded income transactions */
            <p className="text-5xl font-display tabular-nums">{fmt(monthlyIncome)}</p>
          ) : editingIncome ? (
            /* Edits only the signed-in person's own baseline: in a couple the
               figure shown above it is the household's (both summed). */
            <div className="space-y-2 pt-1">
              {isCouple && <p className="text-xs text-muted-foreground">{t('allocation.ownIncomeLabel')}</p>}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-xl">{currency}</span>
                  <input
                    type="number" inputMode="decimal" min="0"
                    aria-label={t('allocation.monthlyIncome')}
                    className="w-44 pl-10 pr-3 py-2 text-3xl font-display tabular-nums border border-border rounded-xl bg-background outline-none focus:border-primary"
                    value={incomeInput}
                    onChange={e => setIncomeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveIncome(); if (e.key === 'Escape') setEditingIncome(false); }}
                    autoFocus
                  />
                </div>
                <button onClick={handleSaveIncome} aria-label={t('allocation.saveIncome')} className="w-11 h-11 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 flex items-center justify-center transition-colors"><Check className="w-5 h-5" /></button>
                <button onClick={() => setEditingIncome(false)} aria-label={t('allocation.cancel')} className="w-11 h-11 border border-line-strong rounded-xl hover:bg-muted flex items-center justify-center transition-colors"><X className="w-5 h-5" /></button>
              </div>
              {isCouple && <p className="text-xs text-muted-foreground">{t('allocation.householdIncomeTotal', { total: fmt(baseIncome) })}</p>}
            </div>
          ) : (
            <button
              className="text-5xl font-display tabular-nums hover:text-primary transition-colors flex items-center gap-3 group text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => { setIncomeInput(String(ownMonthlyIncome)); setEditingIncome(true); }}
              aria-label={t('allocation.editIncome')}
            >
              {fmt(monthlyIncome)}
              <Pencil className="w-5 h-5 text-muted-foreground opacity-60 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
          {!editingIncome && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm text-muted-foreground">
                {hasRecordedIncome
                  ? t('allocation.incomeFromEntries', { count: incomes.length })
                  : isCouple
                    ? t('allocation.incomeBaselineCouple', { own: fmt(ownMonthlyIncome) })
                    : t('allocation.incomeBaseline')}
              </span>
              <button
                onClick={() => setShowAddIncome(true)}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <Plus className="w-4 h-4" /> {t('allocation.addIncome')}
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        {/* Current AND future months use the planning view (income vs. allocated).
            A future month can't have actual spending yet, so the spent/net
            review only makes sense for past months. Going over is "watch"
            (sun), never red. */}
        {isPlanningMonth ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-6 border-t border-border">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('allocation.totalAllocated')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(totalAllocated)}</p>
              <p className="text-xs text-muted-foreground">{pctOf(totalAllocated)}% {t('allocation.pctOfIncome')}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('allocation.goingToPlans')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(planAllocTotal)}</p>
              <p className="text-xs text-muted-foreground">{pctOf(planAllocTotal)}% {t('allocation.pctOfIncome')}</p>
            </div>
            <div className={`col-span-2 sm:col-span-1 rounded-2xl px-4 py-3 space-y-0.5 ${
              isOver ? 'bg-sun-soft text-sun-ink' : isBalanced ? 'bg-reed-soft text-reed' : 'bg-surface-sunk'
            }`}>
              <p className={`text-xs flex items-center gap-1.5 ${isOver || isBalanced ? 'font-semibold' : 'text-muted-foreground'}`}>
                {isOver && <Scale className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                {isBalanced && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                {isOver ? t('allocation.overBudget') : isBalanced ? t('allocation.perfectlyBalanced') : t('allocation.freeCash')}
              </p>
              <p className="text-2xl font-display tabular-nums">{fmt(Math.abs(freeAmount))}</p>
              <p className={`text-xs ${isOver || isBalanced ? '' : 'text-muted-foreground'}`}>
                {isOver ? t('allocation.reduceAllocations') : isBalanced ? t('allocation.allAccountedFor') : t('allocation.unassigned')}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-6 border-t border-border">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('allocation.totalIncome')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(monthlyIncome)}</p>
              <p className="text-xs text-muted-foreground">
                {hasRecordedIncome ? t('allocation.incomeFromEntries', { count: incomes.length }) : t('allocation.incomeBaseline')}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t('allocation.actuallySpent')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(monthReview?.totalActual ?? 0)}</p>
              <p className="text-xs text-muted-foreground">
                {monthReview
                  ? `${Math.round((monthReview.totalActual / Math.max(monthlyIncome, 1)) * 100)}% ${t('allocation.pctOfIncome')}`
                  : t('allocation.noData')}
              </p>
            </div>
            <div className={`col-span-2 sm:col-span-1 rounded-2xl px-4 py-3 space-y-0.5 ${net < 0 ? 'bg-sun-soft text-sun-ink' : 'bg-reed-soft text-reed'}`}>
              <p className="text-xs font-semibold flex items-center gap-1.5">
                {net < 0
                  ? <Scale className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  : <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
                {t('allocation.net')}
              </p>
              <p className="text-2xl font-display tabular-nums">{net < 0 ? '-' : '+'}{fmt(Math.abs(net))}</p>
              <p className="text-xs">{t('allocation.afterExpenses')}</p>
            </div>
          </div>
        )}

        {/* Breakdown bar: segments split by a hairline gap, every colour named in the legend */}
        {monthlyIncome > 0 && (
          <div className="space-y-3">
            <div className="flex h-3 gap-0.5 rounded-full overflow-hidden" role="img" aria-label={barLabel}>
              {segments.map(s => (
                <div
                  key={s.key}
                  className="h-full transition-[width] duration-300 ease-out"
                  style={{ width: `${(s.amount / monthlyIncome) * 100}%`, backgroundColor: KIND_COLOR[s.kind] }}
                  title={`${s.label}: ${fmt(s.amount)}`}
                />
              ))}
              {freePct > 0.5 && (
                <div className="h-full flex-1" style={{ backgroundColor: FREE_COLOR }} title={`${t('allocation.freeCash')}: ${fmt(freeAmount)}`} />
              )}
            </div>
            <ul className="flex gap-x-4 gap-y-1.5 flex-wrap">
              {kindsPresent.map(k => (
                <li key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: KIND_COLOR[k] }} aria-hidden="true" />
                  {t(KIND_LABEL[k])}
                </li>
              ))}
              {freePct > 0.5 && (
                <li className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-line-strong" style={{ backgroundColor: FREE_COLOR }} aria-hidden="true" />
                  {t('allocation.freeCash')}
                </li>
              )}
            </ul>
          </div>
        )}
      </motion.div>

      {/* ── Lines ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-5 md:p-8 space-y-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-display mb-1">{t('allocation.monthlyAllocations')}</h2>
            <p className="text-muted-foreground text-sm">{t('allocation.assignIncome')}</p>
          </div>
          <button
            onClick={() => setShowBudgetSuggestions(true)}
            className="h-10 px-3 shrink-0 inline-flex items-center gap-1.5 text-sm font-medium rounded-xl border border-line-strong hover:bg-muted transition-colors"
          >
            <Wallet className="w-4 h-4" /> {t('budgets.suggestFromHistory')}
          </button>
        </div>

        <p className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-2xl ${
          isBudgetSaved ? 'bg-reed-soft text-reed' : 'bg-surface-sunk text-muted-foreground'
        }`}>
          {isBudgetSaved ? (
            <><CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              {t('allocation.customBudgetForMonth', { month: monthName })}</>
          ) : (
            <><CalendarCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
              {t('allocation.usingDefaultBudget')}</>
          )}
        </p>

        <div className="space-y-5">
          <AnimatePresence initial={false}>
            {local.map((item, index) => {
              const pct          = pctOf(item.allocatedAmount);
              const kind         = kindOf(item.type);
              const color        = KIND_COLOR[kind];
              const isGenerosity = item.type === GENEROSITY_TYPE;
              const isDebt       = item.type === 'debt';
              const linkedPlan = normalizeType(item.type) === 'plan' && item.lifePlanId
                ? rawPlans.find(p => p.id === item.lifePlanId)
                : null;
              const planProgress = linkedPlan && linkedPlan.targetAmount > 0
                ? (linkedPlan.currentAmount / linkedPlan.targetAmount) * 100
                : 0;
              const sliderMax = monthlyIncome || 10000;
              const sliderPct = Math.min(100, (item.allocatedAmount / sliderMax) * 100);

              return (
                <DraggableRow key={item.id} id={item.id} index={index} moveRow={moveRow} canMove={canMove} onDragEnd={handleDragEnd}>
                  {(handleRef) => (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: index * 0.03, duration: 0.2, ease: 'easeOut' }}
                    className="flex items-start gap-3 pb-5 border-b border-border last:border-0 last:pb-0"
                  >
                    {/* The Generosity line stays first: no handle */}
                    {isGenerosity ? (
                      <div className="w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <div
                        ref={handleRef}
                        className="mt-3.5 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 touch-none select-none"
                        title={t('allocation.dragToReorder')}
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                    )}
                    <span className="w-11 h-11 rounded-2xl bg-surface-sunk text-xl flex items-center justify-center shrink-0">
                      {renderAllocationIcon(item.icon)}
                    </span>
                    <div className="flex-1 min-w-0 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {editingNameId === item.id ? (
                            <input
                              className="w-full text-sm font-semibold border border-border rounded-lg px-2 py-1 outline-none focus:border-primary bg-background"
                              value={nameInput}
                              onChange={e => setNameInput(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitEditName(item.id); if (e.key === 'Escape') setEditingNameId(null); }}
                              onBlur={() => commitEditName(item.id)}
                              aria-label={t('allocation.name')}
                              autoFocus
                            />
                          ) : (
                            <button
                              className="font-semibold hover:text-primary transition-colors text-left flex items-center gap-1.5 group min-w-0"
                              onClick={() => { setEditingNameId(item.id); setNameInput(item.name); }}
                            >
                              <span className="truncate">{item.name}</span>
                              <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                            </button>
                          )}
                          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
                            {isGenerosity || isDebt ? (
                              <span>{t(KIND_LABEL[kind])}</span>
                            ) : (
                              <select
                                aria-label={t('allocation.type')}
                                className="border-0 bg-transparent p-0 cursor-pointer text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                                value={normalizeType(item.type)}
                                onChange={e => updateLocal(item.id, { type: e.target.value, lifePlanId: e.target.value !== 'plan' ? null : item.lifePlanId })}
                              >
                                {TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{t(KIND_LABEL[opt])}</option>)}
                              </select>
                            )}
                            {linkedPlan && (
                              <span className="bg-pool-soft text-pool px-2 py-0.5 rounded-full flex items-center gap-1 max-w-full">
                                <span className="shrink-0">{linkedPlan.icon}</span>
                                <span className="truncate">{linkedPlan.title}</span>
                              </span>
                            )}
                            {item.dirty && (
                              <span className="inline-flex items-center gap-1 text-sun-ink font-medium">
                                <span className="w-1.5 h-1.5 rounded-full bg-sun" aria-hidden="true" />
                                {t('allocation.unsaved')}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* The Generosity line can be set to 0 but never deleted */}
                        {!isGenerosity && (
                          <button
                            onClick={() => handleDelete(item.id)}
                            aria-label={t('allocation.deleteLine', { name: item.name })}
                            title={t('allocation.deleteLine', { name: item.name })}
                            className="w-10 h-10 -mt-1.5 -mr-1.5 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-alert-soft rounded-xl transition-colors shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2">
                        <div className="relative shrink-0">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{currency}</span>
                          <input
                            type="number" min="0" step="50" inputMode="decimal"
                            aria-label={t('allocation.amountFor', { name: item.name })}
                            className="w-32 h-10 pl-8 pr-3 text-right text-sm font-semibold tabular-nums border border-border rounded-xl outline-none focus:border-primary bg-background"
                            value={item.allocatedAmount}
                            onChange={e => updateLocal(item.id, { allocatedAmount: Math.max(0, parseInt(e.target.value) || 0) })}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums w-10 text-right shrink-0 sm:order-last">{pct}%</span>
                        <input
                          type="range" min="0" max={sliderMax} step="50"
                          value={item.allocatedAmount}
                          onChange={e => updateLocal(item.id, { allocatedAmount: parseInt(e.target.value) })}
                          aria-label={t('allocation.amountFor', { name: item.name })}
                          className="w-full sm:flex-1 h-2 rounded-full appearance-none cursor-pointer"
                          style={{ background: `linear-gradient(to right, ${color} 0%, ${color} ${sliderPct}%, var(--surface-sunk) ${sliderPct}%, var(--surface-sunk) 100%)` }}
                        />
                      </div>

                      {/* Inline plan progress bar */}
                      {linkedPlan && (
                        <div className="space-y-1">
                          <div className="flex justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                            <span>{t('allocation.planSavedAmount', { amount: fmt(linkedPlan.currentAmount) })}</span>
                            <span>{t('allocation.planProgressOf', { pct: planProgress.toFixed(0), target: fmt(linkedPlan.targetAmount) })}</span>
                          </div>
                          <div className="h-1.5 bg-surface-sunk rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(Math.min(planProgress, 100))} aria-valuemin={0} aria-valuemax={100} aria-label={linkedPlan.title}>
                            <div
                              className="h-full rounded-full transition-[width] duration-500 ease-out"
                              style={{ width: `${Math.min(planProgress, 100)}%`, backgroundColor: linkedPlan.color }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                  )}
                </DraggableRow>
              );
            })}
          </AnimatePresence>
          {/* One neutral, read-only line: the amount only, never which debt. */}
          {hiddenCommitted > 0 && (
            <div className="flex items-start gap-3 pt-5 border-t border-border">
              <div className="w-4 shrink-0" aria-hidden="true" />
              <span className="w-11 h-11 rounded-2xl bg-surface-sunk text-muted-foreground flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4" aria-hidden="true" />
              </span>
              <div className="flex-1 min-w-0 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{t('allocation.partnerPrivateCommitments')}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: KIND_COLOR.debt }} aria-hidden="true" />
                    {t('allocation.partnerPrivateCommitmentsDesc')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{fmt(hiddenCommitted)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{pctOf(hiddenCommitted)}%</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {hasDirtyAllocations && (
          <div className="flex flex-col gap-2">
            {/* Primary: save the edited amounts for THIS month only */}
            <button
              onClick={handleSaveMonthlyBudget} disabled={savingMonthlyBudget}
              className="w-full h-12 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {savingMonthlyBudget
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('allocation.saving')}</>
                : <><CalendarCheck className="w-4 h-4" /> {t('allocation.saveBudgetFor', { month: monthName })}</>}
            </button>
            {/* Secondary: update the default template for months without their own budget */}
            <button
              onClick={handleSaveAllocations} disabled={saving}
              className="w-full h-12 rounded-xl border border-line-strong hover:bg-muted transition-colors font-medium flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('allocation.saving')}</>
                : <><CheckCircle2 className="w-4 h-4" /> {t('allocation.saveAsDefault')}</>}
            </button>
          </div>
        )}
      </motion.div>

      {/* ── How it works ── */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.2 }}
        className="bg-card border border-border rounded-3xl p-6"
      >
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 bg-pool-soft text-pool rounded-2xl flex items-center justify-center shrink-0">
            <Lightbulb className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-semibold mb-1">{t('allocation.howItWorks')}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t('allocation.howItWorksDesc')}
            </p>
          </div>
        </div>
      </motion.div>

      {/* ── Add Allocation Modal ── */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="bg-card border border-border rounded-3xl shadow-soft p-6 w-full max-w-md space-y-5 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{t('allocation.newAllocation')}</h2>
                <button onClick={() => setShowAdd(false)} aria-label={t('allocation.close')} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-4">
                {/* Type selector */}
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">{t('allocation.type')}</label>
                  <div className="flex gap-2" role="radiogroup" aria-label={t('allocation.type')}>
                    {TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt} role="radio" aria-checked={newType === opt}
                        onClick={() => { setNewType(opt); if (opt !== 'plan') setNewLifePlanId(''); }}
                        className={`flex-1 h-11 rounded-xl text-sm font-medium transition-colors border flex items-center justify-center gap-1.5 ${
                          newType === opt
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-line-strong hover:bg-muted'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: KIND_COLOR[opt] }} aria-hidden="true" />
                        {t(KIND_LABEL[opt])}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {newType === 'fixed'    && t('allocation.fixedDesc')}
                    {newType === 'flexible' && t('allocation.flexibleDesc')}
                    {newType === 'plan'     && t('allocation.planDesc')}
                  </p>
                </div>

                {/* Life plan picker */}
                {newType === 'plan' && (
                  <div>
                    <label className="text-sm text-muted-foreground mb-2 block">{t('allocation.lifePlan')}</label>
                    {rawPlans.length === 0 ? (
                      <p className="text-sm text-muted-foreground bg-surface-sunk rounded-xl px-4 py-3">
                        {t('allocation.noLifePlans')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {rawPlans.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { setNewLifePlanId(p.id); if (!newName) setNewName(p.title); if (!newIcon || newIcon === '💰') setNewIcon(p.icon); }}
                            aria-pressed={newLifePlanId === p.id}
                            className={`p-3 rounded-2xl border-2 text-left transition-colors ${
                              newLifePlanId === p.id
                                ? 'border-primary bg-pool-soft'
                                : 'border-border hover:border-line-strong'
                            }`}
                          >
                            <div className="text-xl mb-1">{p.icon}</div>
                            <p className="text-xs font-medium truncate">{p.title}</p>
                            <p className="text-xs text-muted-foreground">{t('allocation.planSavedAmount', { amount: fmt(p.currentAmount) })}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor="new-allocation-name" className="text-sm text-muted-foreground mb-2 block">{t('allocation.name')}</label>
                  <input
                    id="new-allocation-name"
                    type="text"
                    placeholder={t(newType === 'plan' ? 'allocation.namePlaceholderPlan' : newType === 'fixed' ? 'allocation.namePlaceholderFixed' : 'allocation.namePlaceholderFlexible')}
                    autoFocus
                    className="w-full border border-border rounded-xl px-4 py-3 outline-none focus:border-primary bg-background text-sm"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddAllocation(); }}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">{t('allocation.icon')}</label>
                  <IconPicker value={newIcon} onChange={setNewIcon} />
                </div>
              </div>
              <button
                onClick={handleAddAllocation}
                disabled={adding || !newName.trim() || (newType === 'plan' && !newLifePlanId)}
                className="w-full h-12 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {newType === 'plan' ? t('allocation.addPlanAllocation') : t('allocation.addAllocation')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB — Add a line */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.2, ease: 'easeOut' }}
        onClick={() => setShowAdd(true)}
        aria-label={t('allocation.addCategory')}
        style={{ right: 'calc(1.5rem + env(safe-area-inset-right, 0px))', bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        className="fixed w-16 h-16 bg-primary text-primary-foreground rounded-full shadow-soft hover:-translate-y-0.5 transition-transform flex items-center justify-center z-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Plus className="w-7 h-7" />
      </motion.button>

      {/* Add Expense modal */}
      <AddExpense
        isOpen={showAddExpense}
        onClose={() => setShowAddExpense(false)}
        defaultDate={expenseDefaultDate}
      />

      <RecurringManager isOpen={showRecurring} onClose={() => setShowRecurring(false)} />

      <BudgetSuggestions
        isOpen={showBudgetSuggestions}
        onClose={() => setShowBudgetSuggestions(false)}
        onApplied={() => fetchAllocations()}
      />

      <AddIncome
        isOpen={showAddIncome}
        onClose={() => setShowAddIncome(false)}
        defaultDate={expenseDefaultDate}
        onSaved={() => fetchIncomes(selectedMonth)}
      />
    </div>
    </DndProvider>
  );
}
