import { useState, useMemo } from 'react';
import { Plus, TrendingDown, TrendingUp, Filter, Trash2, Loader2, Receipt, Pencil, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useExpenses, type Expense } from '../hooks/useExpenses';
import { useIncome, type Income } from '../hooks/useIncome';
import { useAllocations } from '../hooks/useAllocations';
import { useLanguage } from '../context/LanguageContext';
import { useMonth, monthLabel } from '../context/MonthContext';
import { AddExpense } from './AddExpense';
import { AddIncome } from './AddIncome';
import { EditExpense } from './EditExpense';
import { RulesManager } from './RulesManager';

type Movement =
  | { kind: 'expense'; id: string; date: string; amount: number; expense: Expense }
  | { kind: 'income'; id: string; date: string; amount: number; income: Income };

function getTypeColor(type: string) {
  switch (type) {
    case 'essential':  return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
    case 'investment': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    case 'flexible':   return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    default:           return 'bg-muted text-muted-foreground';
  }
}


export function Activity({ onAddExpense: _onAddExpense }: { onAddExpense?: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';

  const { selectedMonth: currentMonth, isCurrentMonth, isFutureMonth } = useMonth();
  const [filterAllocationId, setFilterAllocationId] = useState<string | 'all'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);

  const { expenses, loading, totalSpent, totalByAllocation, deleteExpense, updateExpense, fetchExpenses } =
    useExpenses(currentMonth);
  const { incomes, totalIncome, deleteIncome, fetchIncomes } = useIncome(currentMonth);
  const { allocations, monthlyIncome } = useAllocations();

  const formatDateLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const todayDate = new Date();
    const yesterday = new Date(todayDate);
    yesterday.setDate(todayDate.getDate() - 1);
    if (date.toDateString() === todayDate.toDateString()) return t('activity.today');
    if (date.toDateString() === yesterday.toDateString()) return t('activity.yesterday');
    return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  };

  // Filter by allocation
  const filtered = useMemo(() => {
    if (filterAllocationId === 'all') return expenses;
    if (filterAllocationId === '__unassigned__') return expenses.filter(e => !e.allocationId);
    return expenses.filter(e => e.allocationId === filterAllocationId);
  }, [expenses, filterAllocationId]);

  // Unified movements (expenses + income). Income only shows in the unfiltered
  // view, since the chips filter expenses by category.
  const movements = useMemo<Movement[]>(() => {
    const incForView = filterAllocationId === 'all' ? incomes : [];
    return [
      ...filtered.map((e): Movement => ({ kind: 'expense', id: e.id, date: e.date, amount: e.amount, expense: e })),
      ...incForView.map((i): Movement => ({ kind: 'income', id: i.id, date: i.date, amount: i.amount, income: i })),
    ];
  }, [filtered, incomes, filterAllocationId]);

  // Group movements by date (newest day first, newest within the day first)
  const grouped = useMemo(() => {
    const map: Record<string, Movement[]> = {};
    for (const m of movements) {
      const day = m.date.slice(0, 10);
      (map[day] ??= []).push(m);
    }
    return Object.entries(map)
      .map(([day, items]) => [day, items.sort((a, b) => b.date.localeCompare(a.date))] as [string, Movement[]])
      .sort(([a], [b]) => b.localeCompare(a));
  }, [movements]);

  // Stats
  const topAllocation = useMemo(() => {
    let topId: string | null = null;
    let topAmt = 0;
    for (const [id, amt] of Object.entries(totalByAllocation)) {
      if (id !== '__unassigned__' && amt > topAmt) { topId = id; topAmt = amt; }
    }
    if (!topId) return null;
    const alloc = allocations.find(a => a.id === topId);
    return alloc ? { name: alloc.name, icon: alloc.icon, amount: topAmt } : null;
  }, [totalByAllocation, allocations]);

  const avgPerDay = useMemo(() => {
    const days = new Set(expenses.map(e => e.date.slice(0, 10))).size;
    return days > 0 ? totalSpent / days : 0;
  }, [expenses, totalSpent]);

  // Budget used % (expenses vs monthlyIncome)
  const budgetUsedPct = monthlyIncome > 0 ? Math.min((totalSpent / monthlyIncome) * 100, 100) : 0;

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const result = await deleteExpense(id);
    setDeletingId(null);
    if ('error' in result) toast.error(result.error as string);
    else toast.success(t('activity.expenseRemoved'));
  };

  const handleDeleteIncome = async (id: string) => {
    setDeletingId(id);
    const result = await deleteIncome(id);
    setDeletingId(null);
    if ('error' in result) toast.error(result.error as string);
    else toast.success(t('activity.incomeRemoved'));
  };

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl tracking-tight">{t('activity.title')}</h1>
          <p className="text-muted-foreground">{t('activity.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowRules(true)}
          className="px-4 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm flex items-center gap-2 shrink-0"
        >
          <Wand2 className="w-4 h-4" /> {t('rules.manageButton')}
        </button>
      </motion.div>

      {/* Month display */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="flex items-center justify-center gap-3 bg-card border border-border rounded-2xl px-5 py-3"
      >
        <p className="font-display text-sm capitalize">{monthLabel(currentMonth, locale)}</p>
        {isFutureMonth && (
          <span className="text-xs text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400 px-2 py-0.5 rounded-full">
            {t('monthlyReview.nextMonth')}
          </span>
        )}
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
              <TrendingDown className="w-5 h-5" />
            </div>
            <p className="text-sm opacity-90">{t('activity.totalSpent')}</p>
          </div>
          <p className="text-3xl font-display">€{totalSpent.toFixed(2)}</p>
          <p className="text-sm opacity-75 mt-1">{t('activity.avgPerDay', { amount: avgPerDay.toFixed(2) })}</p>
          {totalIncome > 0 && (
            <p className="text-sm opacity-75 mt-0.5">{t('activity.incomeThisMonth', { amount: totalIncome.toFixed(2) })}</p>
          )}
          {monthlyIncome > 0 && (
            <div className="mt-3">
              <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white/70 rounded-full transition-all"
                  style={{ width: `${budgetUsedPct}%` }}
                />
              </div>
              <p className="text-xs opacity-60 mt-1">{budgetUsedPct.toFixed(0)}% {t('activity.pctOfIncome')}</p>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          className="bg-card border border-border rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
              <Receipt className="w-5 h-5 text-secondary" />
            </div>
            <p className="text-sm text-muted-foreground">{t('activity.transactions')}</p>
          </div>
          <p className="text-3xl font-display">{expenses.length}</p>
          <p className="text-sm text-muted-foreground mt-1">{monthLabel(currentMonth, locale)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-card border border-border rounded-2xl p-6"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
              <Filter className="w-5 h-5 text-accent" />
            </div>
            <p className="text-sm text-muted-foreground">{t('activity.topCategory')}</p>
          </div>
          {topAllocation ? (
            <>
              <p className="text-xl font-display flex items-center gap-2">
                <span>{topAllocation.icon}</span>{topAllocation.name}
              </p>
              <p className="text-sm text-muted-foreground mt-1">€{topAllocation.amount.toFixed(2)} {t('activity.totalSpent')}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-2">{t('activity.noExpenses')}</p>
          )}
        </motion.div>
      </div>

      {/* Allocation filter chips */}
      {allocations.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
          className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1"
        >
          <button
            onClick={() => setFilterAllocationId('all')}
            className={`px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-all ${
              filterAllocationId === 'all' ? 'bg-primary text-white' : 'bg-card border border-border hover:bg-muted'
            }`}
          >
            {t('activity.all', { count: expenses.length })}
          </button>
          {allocations.map(a => {
            const count = expenses.filter(e => e.allocationId === a.id).length;
            if (count === 0 && filterAllocationId !== a.id) return null;
            return (
              <button
                key={a.id}
                onClick={() => setFilterAllocationId(a.id)}
                className={`px-4 py-2 rounded-xl text-sm whitespace-nowrap flex items-center gap-2 transition-all ${
                  filterAllocationId === a.id ? 'bg-primary text-white' : 'bg-card border border-border hover:bg-muted'
                }`}
              >
                <span>{a.icon}</span>
                <span>{a.name}</span>
                <span className="opacity-70">({count})</span>
              </button>
            );
          })}
          {expenses.some(e => !e.allocationId) && (
            <button
              onClick={() => setFilterAllocationId('__unassigned__')}
              className={`px-4 py-2 rounded-xl text-sm whitespace-nowrap transition-all ${
                filterAllocationId === '__unassigned__' ? 'bg-primary text-white' : 'bg-card border border-border hover:bg-muted'
              }`}
            >
              ❓ {t('activity.unassigned', { count: expenses.filter(e => !e.allocationId).length })}
            </button>
          )}
        </motion.div>
      )}

      {/* Movements list (expenses + income) */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : movements.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-dashed border-border rounded-2xl p-12 text-center"
        >
          <Receipt className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-display text-lg mb-1">{t('activity.noMovements')}</p>
          <p className="text-sm text-muted-foreground mb-6">
            {filterAllocationId === 'all'
              ? t('activity.addFirstMovement')
              : t('activity.noExpensesInCategory')}
          </p>
          {filterAllocationId === 'all' && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-5 py-2.5 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors text-sm"
            >
              {t('activity.addExpense')}
            </button>
          )}
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="space-y-6"
        >
          {grouped.map(([day, dayItems], groupIdx) => {
            const net = dayItems.reduce((s, m) => m.kind === 'income' ? s + m.amount : s - m.amount, 0);
            return (
            <div key={day}>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-sm font-medium text-muted-foreground">{formatDateLabel(day)}</p>
                <p className={`text-sm ${net > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {net > 0 ? '+' : ''}€{net.toFixed(2)}
                </p>
              </div>
              <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
                <AnimatePresence initial={false}>
                  {dayItems.map((m, idx) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20, height: 0 }}
                      transition={{ delay: groupIdx * 0.04 + idx * 0.02 }}
                      className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors gap-3"
                    >
                      {m.kind === 'expense' ? (
                        <>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-xl flex items-center justify-center text-xl shrink-0">
                              {m.expense.allocation?.icon ?? '❓'}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {m.expense.description || m.expense.allocation?.name || t('activity.expense')}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                {m.expense.allocation ? (
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeColor(m.expense.allocation.type)}`}>
                                    {m.expense.allocation.name}
                                  </span>
                                ) : (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {t('addExpense.unassigned')}
                                  </span>
                                )}
                                {m.expense.account && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {m.expense.account.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <p className="text-lg font-display">€{m.amount.toFixed(2)}</p>
                            <button
                              onClick={() => setEditing(m.expense)}
                              className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(m.id)}
                              disabled={deletingId === m.id}
                              className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {deletingId === m.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
                              <TrendingUp className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {m.income.description || t(`addIncome.cat.${m.income.category}`)}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                  {t(`addIncome.cat.${m.income.category}`)}
                                </span>
                                {m.income.account && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {m.income.account.name}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <p className="text-lg font-display text-emerald-600">+€{m.amount.toFixed(2)}</p>
                            <button
                              onClick={() => setEditingIncome(m.income)}
                              className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteIncome(m.id)}
                              disabled={deletingId === m.id}
                              className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                            >
                              {deletingId === m.id
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <Trash2 className="w-4 h-4" />}
                            </button>
                          </div>
                        </>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
            );
          })}
        </motion.div>
      )}

      {/* FAB speed-dial: choose expense or income */}
      <div className="fixed right-6 bottom-6 z-40 flex flex-col items-end gap-3">
        <AnimatePresence>
          {fabOpen && (
            <>
              <motion.button
                initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.8 }}
                onClick={() => { setFabOpen(false); setShowAddIncome(true); }}
                className="flex items-center gap-2 pl-4 pr-5 py-3 bg-emerald-600 text-white rounded-full shadow-xl hover:bg-emerald-600/90 transition-colors text-sm"
              >
                <TrendingUp className="w-5 h-5" /> {t('activity.addIncome')}
              </motion.button>
              <motion.button
                initial={{ opacity: 0, y: 10, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.8 }}
                onClick={() => { setFabOpen(false); setShowAdd(true); }}
                className="flex items-center gap-2 pl-4 pr-5 py-3 bg-primary text-primary-foreground rounded-full shadow-xl hover:bg-primary/90 transition-colors text-sm"
              >
                <TrendingDown className="w-5 h-5" /> {t('activity.addExpense')}
              </motion.button>
            </>
          )}
        </AnimatePresence>
        <motion.button
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
          onClick={() => setFabOpen(v => !v)}
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
          className="w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center"
        >
          <Plus className={`w-7 h-7 transition-transform ${fabOpen ? 'rotate-45' : ''}`} />
        </motion.button>
      </div>

      <AddExpense
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={() => fetchExpenses(currentMonth)}
      />

      <AddIncome
        isOpen={showAddIncome || !!editingIncome}
        editing={editingIncome}
        onClose={() => { setShowAddIncome(false); setEditingIncome(null); }}
        onSaved={() => fetchIncomes(currentMonth)}
      />

      <EditExpense
        isOpen={!!editing}
        expense={editing}
        allocations={allocations}
        onClose={() => setEditing(null)}
        onSave={(payload) => updateExpense(editing!.id, payload)}
      />

      <RulesManager isOpen={showRules} onClose={() => setShowRules(false)} />
    </div>
  );
}
