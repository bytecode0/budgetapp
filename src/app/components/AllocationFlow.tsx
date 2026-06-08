import { useState, useEffect, useRef, useCallback } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useTranslation } from 'react-i18next';
import {
  DollarSign, TrendingUp, CheckCircle2, Plus, Trash2,
  Pencil, X, Check, Loader2, CalendarCheck, GripVertical, Repeat,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useAllocations } from '../hooks/useAllocations';
import { usePlans } from '../hooks/usePlans';
import { useMonthlyBudget, useMonthlyReview } from '../hooks/useMonthlyBudget';
import { AddExpense } from './AddExpense';
import { RecurringManager } from './RecurringManager';
import { useLanguage } from '../context/LanguageContext';
import { useMonth, monthLabel } from '../context/MonthContext';


const ALLOCATION_ICONS = [
  '🏠','🛡️','🎯','💰','🚗','✈️','🎓','💊','🍔','☕',
  '👕','🎮','🎵','📚','🏋️','💄','🐾','🌱','🔧','💡',
  '🎁','📱','🖥️','🏖️','🏥','🏦','🛒','🎨','🎭','⚽',
];

const TYPE_OPTIONS = [
  { value: 'fixed',    label: 'Fixed',    color: 'bg-blue-500' },
  { value: 'flexible', label: 'Flexible', color: 'bg-amber-500' },
  { value: 'plan',     label: 'Plan',     color: 'bg-violet-500' },
];

function normalizeType(type: string): string {
  if (type === 'essential') return 'fixed';
  if (type === 'investment') return 'flexible';
  return type;
}

function getTypeColor(type: string) {
  const t = normalizeType(type);
  switch (t) {
    case 'fixed':    return '#1E3A8A';
    case 'flexible': return '#F59E0B';
    case 'plan':     return '#8B5CF6';
    default:         return '#9CA3AF';
  }
}

const FREE_COLOR = 'rgba(255,255,255,0.2)';

// ── Drag-and-drop ────────────────────────────────────────────────────────────

const DRAG_TYPE = 'ALLOCATION_ROW';

interface DragItem { id: string; index: number }

function DraggableRow({
  id, index, moveRow, onDragEnd, children,
}: {
  id: string;
  index: number;
  moveRow: (from: number, to: number) => void;
  onDragEnd: () => void;
  children: (handleRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
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
      moveRow(draggedItem.index, index);
      draggedItem.index = index;
    },
  });

  drop(rowRef);
  drag(handleRef);

  return (
    <div
      ref={rowRef}
      className={`transition-opacity rounded-xl ${isDragging ? 'opacity-40' : 'opacity-100'} ${isOver ? 'ring-2 ring-primary/20' : ''}`}
    >
      {children(handleRef)}
    </div>
  );
}

interface LocalAllocation {
  id: string; name: string; icon: string; type: string;
  lifePlanId: string | null;
  allocatedAmount: number; actualAmount: number; isDefault: boolean; dirty: boolean;
}

export function AllocationFlow() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';

  const {
    allocations: rawAllocations, monthlyIncome, loading,
    updateIncome, createAllocation, updateAllocation, deleteAllocation, reorderAllocations,
  } = useAllocations();

  const { plans: rawPlans, loading: plansLoading } = usePlans();

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

  useEffect(() => {
    setLocal(rawAllocations.map(a => ({
      id: a.id, name: a.name, icon: a.icon, type: a.type,
      lifePlanId: a.lifePlanId ?? null,
      allocatedAmount: a.allocatedAmount, actualAmount: a.actualAmount,
      isDefault: a.isDefault, dirty: false,
    })));
  }, [rawAllocations]);

  // ── Derived numbers ─────────────────────────────────────
  const totalAllocated = local.reduce((s, a) => s + a.allocatedAmount, 0);
  const planAllocTotal = local
    .filter(a => normalizeType(a.type) === 'plan')
    .reduce((s, a) => s + a.allocatedAmount, 0);
  const freeAmount  = monthlyIncome - totalAllocated;
  const isOver      = freeAmount < -0.5;
  const isBalanced  = Math.abs(freeAmount) <= 0.5;

  // ── Handlers — allocations ──────────────────────────────
  const updateLocal = (id: string, patch: Partial<LocalAllocation>) =>
    setLocal(prev => prev.map(a => a.id === id ? { ...a, ...patch, dirty: true } : a));

  const handleSaveAllocations = async () => {
    setSaving(true);
    const dirty = local.filter(a => a.dirty);
    const results = await Promise.all(
      dirty.map(a => updateAllocation(a.id, {
        name: a.name, icon: a.icon, type: a.type, allocatedAmount: a.allocatedAmount,
        lifePlanId: a.lifePlanId,
      } as any))
    );
    setSaving(false);
    if (results.some(r => r && 'error' in r && r.error)) {
      toast.error('Some allocations failed to save');
    } else {
      setLocal(prev => prev.map(a => ({ ...a, dirty: false })));
      toast.success('Allocations saved!');
    }
  };

  const handleSaveIncome = async () => {
    const amount = parseFloat(incomeInput.replace(/,/g, ''));
    if (isNaN(amount) || amount < 0) { toast.error('Enter a valid amount'); return; }
    const result = await updateIncome(amount);
    if ('error' in result && result.error) toast.error(result.error as string);
    else { toast.success('Income updated!'); setEditingIncome(false); }
  };

  const handleAddAllocation = async () => {
    if (!newName.trim()) { toast.error('Enter a name'); return; }
    if (newType === 'plan' && !newLifePlanId) { toast.error('Select a life plan'); return; }
    setAdding(true);
    const result = await createAllocation({
      name: newName.trim(), icon: newIcon, type: newType,
      lifePlanId: newType === 'plan' ? newLifePlanId : null,
    });
    setAdding(false);
    if ('error' in result && result.error) toast.error(result.error as string);
    else {
      toast.success('Allocation added!');
      setShowAdd(false); setNewName(''); setNewIcon('💰'); setNewType('flexible'); setNewLifePlanId('');
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteAllocation(id);
    if ('error' in result && result.error) toast.error(result.error as string);
    else toast.success('Removed');
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

  const handleDragEnd = useCallback(() => {
    const order = localRef.current.map((item, index) => ({ id: item.id, sortOrder: index }));
    reorderAllocations(order);
  }, [reorderAllocations]);

  // ── Selected month (hero header + expenses) ────────────────────
  const { selectedMonth, isCurrentMonth, isFutureMonth } = useMonth();
  const { saving: savingMonthlyBudget, isSaved: isBudgetSaved, saveBudgets } =
    useMonthlyBudget(selectedMonth);
  const { review: monthReview } = useMonthlyReview(selectedMonth);

  const expenseDefaultDate = isCurrentMonth
    ? new Date().toISOString().slice(0, 10)
    : (() => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        return `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      })();

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showRecurring, setShowRecurring] = useState(false);

  const handleSaveMonthlyBudget = async () => {
    const entries = local.map(a => ({ allocationId: a.id, allocatedAmount: a.allocatedAmount }));
    const result = await saveBudgets(entries);
    if ('error' in result) toast.error(result.error as string);
    else toast.success(t('allocation.budgetSnapshotSaved', { month: monthLabel(selectedMonth, locale) }));
  };

  if (loading || plansLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const freePct      = monthlyIncome > 0 ? Math.max(0, (freeAmount / monthlyIncome) * 100) : 0;
  const hasPlanAllocs = local.some(a => normalizeType(a.type) === 'plan');

  return (
    <DndProvider backend={HTML5Backend}>
    <div className="space-y-6 pb-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl tracking-tight">{t('allocation.title')}</h1>
          <p className="text-muted-foreground">{t('allocation.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowRecurring(true)}
          className="px-4 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm flex items-center gap-2 shrink-0"
        >
          <Repeat className="w-4 h-4" /> {t('recurring.manageButton')}
        </button>
      </motion.div>

      {/* ── Income Overview Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl p-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
        <div className="relative z-10">

          {/* Month label + Add expense */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2 bg-white/15 rounded-xl px-3 py-1.5">
              <span className="text-sm font-medium capitalize">{monthLabel(selectedMonth, locale)}</span>
              {isFutureMonth && <span className="text-xs opacity-70">{t('monthlyReview.nextMonth')}</span>}
            </div>
            <button
              onClick={() => setShowAddExpense(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              {isCurrentMonth
                ? t('allocation.addExpense')
                : t('allocation.addToMonth', { month: monthLabel(selectedMonth, locale).split(' ')[0] })}
            </button>
          </div>

          {/* Income amount */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm opacity-75 mb-2">{t('allocation.monthlyIncome')}</p>
              {editingIncome ? (
                <div className="flex items-center gap-3">
                  <span className="text-3xl opacity-75">€</span>
                  <input
                    type="number"
                    className="text-4xl bg-white/20 rounded-xl px-3 py-1 w-40 outline-none text-white"
                    value={incomeInput}
                    onChange={e => setIncomeInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveIncome(); if (e.key === 'Escape') setEditingIncome(false); }}
                    autoFocus
                  />
                  <button onClick={handleSaveIncome} className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors"><Check className="w-4 h-4" /></button>
                  <button onClick={() => setEditingIncome(false)} className="w-9 h-9 bg-white/20 hover:bg-white/30 rounded-lg flex items-center justify-center transition-colors"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button
                  className="text-5xl font-display hover:opacity-80 transition-opacity flex items-center gap-3 group"
                  onClick={() => { setIncomeInput(String(monthlyIncome)); setEditingIncome(true); }}
                >
                  €{monthlyIncome.toLocaleString()}
                  <Pencil className="w-5 h-5 opacity-0 group-hover:opacity-60 transition-opacity" />
                </button>
              )}
            </div>
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
              <DollarSign className="w-8 h-8" />
            </div>
          </div>

          {/* Stats */}
          {isCurrentMonth ? (
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-white/20">
              <div>
                <p className="text-xs opacity-75 mb-1">{t('allocation.totalAllocated')}</p>
                <p className="text-xl font-display">€{totalAllocated.toLocaleString()}</p>
                <p className="text-xs opacity-60">
                  {monthlyIncome > 0 ? ((totalAllocated / monthlyIncome) * 100).toFixed(0) : 0}% {t('allocation.pctOfIncome')}
                </p>
              </div>
              <div>
                <p className="text-xs opacity-75 mb-1">{t('allocation.goingToPlans')}</p>
                <p className="text-xl font-display">€{planAllocTotal.toLocaleString()}</p>
                <p className="text-xs opacity-60">
                  {monthlyIncome > 0 ? ((planAllocTotal / monthlyIncome) * 100).toFixed(0) : 0}% {t('allocation.pctOfIncome')}
                </p>
              </div>
              <div>
                <p className="text-xs opacity-75 mb-1">
                  {isOver ? t('allocation.overBudget') : isBalanced ? t('allocation.perfectlyBalanced') : t('allocation.freeCash')}
                </p>
                <p className={`text-xl font-display ${isOver ? 'text-red-300' : isBalanced ? 'text-emerald-300' : ''}`}>
                  €{Math.abs(freeAmount).toLocaleString()}
                </p>
                <p className="text-xs opacity-60">
                  {isOver ? t('allocation.reduceAllocations') : isBalanced ? `✓ ${t('allocation.allAccountedFor')}` : t('allocation.unassigned')}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-white/20">
              <div>
                <p className="text-xs opacity-75 mb-1">{t('allocation.budgeted')}</p>
                <p className="text-xl font-display">€{totalAllocated.toLocaleString()}</p>
                <p className="text-xs opacity-60">{t('allocation.plannedForMonth')}</p>
              </div>
              <div>
                <p className="text-xs opacity-75 mb-1">{t('allocation.actuallySpent')}</p>
                <p className={`text-xl font-display ${monthReview && monthReview.totalActual > totalAllocated ? 'text-red-300' : 'text-emerald-300'}`}>
                  €{(monthReview?.totalActual ?? 0).toLocaleString()}
                </p>
                <p className="text-xs opacity-60">
                  {monthReview
                    ? `${Math.round((monthReview.totalActual / Math.max(totalAllocated, 1)) * 100)}% ${t('allocation.pctOfBudget')}`
                    : t('allocation.noData')}
                </p>
              </div>
              <div>
                <p className="text-xs opacity-75 mb-1">
                  {monthReview && monthReview.totalActual > totalAllocated
                    ? t('allocation.overBudgetLabel')
                    : t('allocation.savedVsBudget')}
                </p>
                <p className={`text-xl font-display ${monthReview && monthReview.totalActual > totalAllocated ? 'text-red-300' : 'text-emerald-300'}`}>
                  {monthReview ? `€${Math.abs(monthReview.totalActual - totalAllocated).toLocaleString()}` : '—'}
                </p>
                <p className="text-xs opacity-60">
                  {monthReview && monthReview.totalActual > totalAllocated
                    ? t('allocation.abovePlan')
                    : t('allocation.underPlan')}
                </p>
              </div>
            </div>
          )}

          {/* Breakdown bar */}
          {monthlyIncome > 0 && (
            <div className="mt-6">
              <div className="flex h-3 rounded-full overflow-hidden">
                {local.filter(a => a.allocatedAmount > 0).map(a => (
                  <div
                    key={a.id}
                    className="h-full transition-all"
                    style={{ width: `${(a.allocatedAmount / monthlyIncome) * 100}%`, backgroundColor: getTypeColor(a.type) }}
                    title={`${a.name}: €${a.allocatedAmount.toLocaleString()}`}
                  />
                ))}
                {freePct > 0.5 && (
                  <div className="h-full rounded-r-full" style={{ width: `${freePct}%`, backgroundColor: FREE_COLOR }} />
                )}
              </div>
              <div className="flex gap-4 mt-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs opacity-75">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>{t('allocation.fixed')}</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs opacity-75">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>{t('allocation.flexible')}</span>
                </div>
                {hasPlanAllocs && (
                  <div className="flex items-center gap-1.5 text-xs opacity-75">
                    <div className="w-2 h-2 rounded-full bg-violet-500" />
                    <span>{t('allocation.plans')}</span>
                  </div>
                )}
                {freePct > 0.5 && (
                  <div className="flex items-center gap-1.5 text-xs opacity-75">
                    <div className="w-2 h-2 rounded-full bg-white/40" />
                    <span>{t('allocation.freeCash')}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Allocations ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="bg-card border border-border rounded-2xl p-6 md:p-8 space-y-6"
      >
        <div>
          <h2 className="text-2xl font-display mb-1">{t('allocation.monthlyAllocations')}</h2>
          <p className="text-muted-foreground text-sm">{t('allocation.assignIncome')}</p>
        </div>

        {isBudgetSaved && (
          <div className="flex items-center gap-2 text-xs text-secondary bg-secondary/10 px-3 py-2 rounded-xl">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('allocation.budgetSnapshotSaved', { month: monthLabel(selectedMonth, locale) })}
          </div>
        )}

        <div className="space-y-5">
          <AnimatePresence initial={false}>
            {local.map((item, index) => {
              const pct        = monthlyIncome > 0 ? Math.round((item.allocatedAmount / monthlyIncome) * 100) : 0;
              const color      = getTypeColor(item.type);
              const linkedPlan = normalizeType(item.type) === 'plan' && item.lifePlanId
                ? rawPlans.find(p => p.id === item.lifePlanId)
                : null;
              const planProgress = linkedPlan && linkedPlan.targetAmount > 0
                ? (linkedPlan.currentAmount / linkedPlan.targetAmount) * 100
                : 0;

              return (
                <DraggableRow key={item.id} id={item.id} index={index} moveRow={moveRow} onDragEnd={handleDragEnd}>
                  {(handleRef) => (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.04 }}
                    className="space-y-3 pb-5 border-b border-border last:border-0 last:pb-0"
                  >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        ref={handleRef}
                        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 touch-none select-none"
                        title="Drag to reorder"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                      <span className="text-2xl shrink-0 w-10 h-10 flex items-center justify-center">{item.icon}</span>
                      <div className="min-w-0">
                        {editingNameId === item.id ? (
                          <input
                            className="text-sm font-medium border border-border rounded-lg px-2 py-1 outline-none focus:border-primary bg-background"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEditName(item.id); if (e.key === 'Escape') setEditingNameId(null); }}
                            onBlur={() => commitEditName(item.id)}
                            autoFocus
                          />
                        ) : (
                          <button
                            className="text-sm font-medium hover:text-primary transition-colors text-left flex items-center gap-1.5 group"
                            onClick={() => { setEditingNameId(item.id); setNameInput(item.name); }}
                          >
                            {item.name}
                            <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                          </button>
                        )}
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <select
                            className="text-xs border-0 bg-transparent p-0 cursor-pointer text-muted-foreground focus:outline-none"
                            value={normalizeType(item.type)}
                            onChange={e => updateLocal(item.id, { type: e.target.value, lifePlanId: e.target.value !== 'plan' ? null : item.lifePlanId })}
                          >
                            {TYPE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{t(`allocation.${opt.value === 'plan' ? 'plans' : opt.value}`)}</option>)}
                          </select>
                          {normalizeType(item.type) === 'plan' && item.lifePlanId && (() => {
                            const linked = rawPlans.find(p => p.id === item.lifePlanId);
                            return linked ? (
                              <span className="text-xs bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full flex items-center gap-1">
                                {linked.icon} {linked.title}
                              </span>
                            ) : null;
                          })()}
                          {item.dirty && <span className="text-xs text-amber-500">{t('allocation.unsaved')}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">€</span>
                        <input
                          type="number" min="0" step="50"
                          className="w-24 text-right text-sm font-medium border border-border rounded-lg px-2 py-1 outline-none focus:border-primary bg-background"
                          value={item.allocatedAmount}
                          onChange={e => updateLocal(item.id, { allocatedAmount: Math.max(0, parseInt(e.target.value) || 0) })}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                      <button
                        onClick={() => handleDelete(item.id)}
                        className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <input
                    type="range" min="0" max={monthlyIncome || 10000} step="50"
                    value={item.allocatedAmount}
                    onChange={e => updateLocal(item.id, { allocatedAmount: parseInt(e.target.value) })}
                    className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ background: `linear-gradient(to right, ${color} 0%, ${color} ${pct}%, #E5E7EB ${pct}%, #E5E7EB 100%)` }}
                  />
                  {/* Inline plan progress bar */}
                  {linkedPlan && (
                    <div className="space-y-1 pt-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>€{linkedPlan.currentAmount.toLocaleString()} saved</span>
                        <span>{planProgress.toFixed(0)}% of €{linkedPlan.targetAmount.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(planProgress, 100)}%` }}
                          transition={{ duration: 0.8, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: linkedPlan.color }}
                        />
                      </div>
                    </div>
                  )}
                  </motion.div>
                  )}
                </DraggableRow>
              );
            })}
          </AnimatePresence>
        </div>

        <div className="flex flex-col gap-2">
          {hasDirtyAllocations && (
            <button
              onClick={handleSaveAllocations} disabled={saving}
              className="w-full py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                : <><CheckCircle2 className="w-4 h-4" /> {t('allocation.saveAsDefault')}</>}
            </button>
          )}
          <button
            onClick={handleSaveMonthlyBudget} disabled={savingMonthlyBudget}
            className={`w-full py-3 rounded-xl border transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50 ${
              isBudgetSaved
                ? 'border-secondary/30 text-secondary hover:bg-secondary/5'
                : 'border-primary/30 text-primary hover:bg-primary/5'
            }`}
          >
            {savingMonthlyBudget
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
              : isBudgetSaved
              ? <><CheckCircle2 className="w-4 h-4" /> {t('allocation.updateMonthSnapshot', { month: monthLabel(selectedMonth, locale) })}</>
              : <><CalendarCheck className="w-4 h-4" /> {t('allocation.saveBudgetFor', { month: monthLabel(selectedMonth, locale) })}</>
            }
          </button>
        </div>
      </motion.div>

      {/* ── Tip ── */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        className="bg-gradient-to-br from-accent/10 to-accent/5 border border-accent/20 rounded-xl p-6"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-accent/20 rounded-lg flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-accent" />
          </div>
          <div>
            <p className="font-display mb-2">{t('allocation.howItWorks')}</p>
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
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowAdd(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg">{t('allocation.newAllocation')}</h3>
                <button onClick={() => setShowAdd(false)} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                {/* Type selector */}
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">{t('allocation.type')}</label>
                  <div className="flex gap-2">
                    {TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt.value} onClick={() => { setNewType(opt.value); if (opt.value !== 'plan') setNewLifePlanId(''); }}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                          newType === opt.value
                            ? opt.value === 'fixed'    ? 'bg-blue-600 text-white border-blue-600'
                            : opt.value === 'flexible' ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-violet-600 text-white border-violet-600'
                            : 'border-border hover:bg-muted'
                        }`}
                      >{t(`allocation.${opt.value === 'plan' ? 'plans' : opt.value}`)}</button>
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
                      <p className="text-sm text-muted-foreground bg-muted rounded-xl px-4 py-3">
                        {t('allocation.noLifePlans')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                        {rawPlans.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { setNewLifePlanId(p.id); if (!newName) setNewName(p.title); if (!newIcon || newIcon === '💰') setNewIcon(p.icon); }}
                            className={`p-3 rounded-xl border-2 text-left transition-all ${
                              newLifePlanId === p.id
                                ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30'
                                : 'border-border hover:border-violet-400'
                            }`}
                          >
                            <div className="text-xl mb-1">{p.icon}</div>
                            <p className="text-xs font-medium truncate">{p.title}</p>
                            <p className="text-xs text-muted-foreground">€{p.currentAmount.toLocaleString()} saved</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">{t('allocation.name')}</label>
                  <input
                    type="text"
                    placeholder={newType === 'plan' ? 'e.g. Emergency Fund' : newType === 'fixed' ? 'e.g. Gym Membership' : 'e.g. Dining Out'}
                    autoFocus
                    className="w-full border border-border rounded-xl px-4 py-3 outline-none focus:border-primary bg-background text-sm"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddAllocation(); }}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">{t('allocation.icon')}</label>
                  <div className="grid grid-cols-10 gap-1.5">
                    {ALLOCATION_ICONS.map(emoji => (
                      <button
                        key={emoji} onClick={() => setNewIcon(emoji)}
                        className={`w-9 h-9 text-lg rounded-lg flex items-center justify-center transition-all ${newIcon === emoji ? 'bg-primary/10 ring-2 ring-primary scale-110' : 'hover:bg-muted'}`}
                      >{emoji}</button>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={handleAddAllocation}
                disabled={adding || !newName.trim() || (newType === 'plan' && !newLifePlanId)}
                className={`w-full py-3 text-white rounded-xl hover:shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${
                  newType === 'plan' ? 'bg-violet-600 hover:bg-violet-700' : 'bg-gradient-to-r from-primary to-secondary'
                }`}
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {newType === 'plan' ? t('allocation.addPlanAllocation') : t('allocation.addAllocation')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB — Add category */}
      <motion.button
        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
        onClick={() => setShowAdd(true)}
        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center z-40 group"
      >
        <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
      </motion.button>

      {/* Add Expense modal */}
      <AddExpense
        isOpen={showAddExpense}
        onClose={() => setShowAddExpense(false)}
        defaultDate={expenseDefaultDate}
      />

      <RecurringManager isOpen={showRecurring} onClose={() => setShowRecurring(false)} />
    </div>
    </DndProvider>
  );
}
