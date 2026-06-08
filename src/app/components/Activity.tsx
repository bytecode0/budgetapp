import { useState, useMemo } from 'react';
import { Plus, TrendingDown, Filter, Trash2, Loader2, Receipt, Pencil, Wand2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useExpenses, type Expense } from '../hooks/useExpenses';
import { useAllocations } from '../hooks/useAllocations';
import { useLanguage } from '../context/LanguageContext';
import { useMonth, monthLabel } from '../context/MonthContext';
import { AddExpense } from './AddExpense';
import { EditExpense } from './EditExpense';
import { RulesManager } from './RulesManager';

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

  const { expenses, loading, totalSpent, totalByAllocation, deleteExpense, updateExpense, fetchExpenses } =
    useExpenses(currentMonth);
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

  // Group by date
  const grouped = useMemo(() => {
    const map: Record<string, typeof filtered> = {};
    for (const e of filtered) {
      const day = e.date.slice(0, 10);
      if (!map[day]) map[day] = [];
      map[day].push(e);
    }
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

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
    else toast.success('Expense removed');
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

      {/* Expense list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-dashed border-border rounded-2xl p-12 text-center"
        >
          <Receipt className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="font-display text-lg mb-1">{t('activity.noExpenses')}</p>
          <p className="text-sm text-muted-foreground mb-6">
            {filterAllocationId === 'all'
              ? t('activity.addFirstExpense')
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
          {grouped.map(([day, dayExpenses], groupIdx) => (
            <div key={day}>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-sm font-medium text-muted-foreground">{formatDateLabel(day)}</p>
                <p className="text-sm text-muted-foreground">€{dayExpenses.reduce((s, e) => s + e.amount, 0).toFixed(2)}</p>
              </div>
              <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
                <AnimatePresence initial={false}>
                  {dayExpenses.map((expense, idx) => (
                    <motion.div
                      key={expense.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20, height: 0 }}
                      transition={{ delay: groupIdx * 0.04 + idx * 0.02 }}
                      className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 bg-gradient-to-br from-primary/10 to-secondary/10 rounded-xl flex items-center justify-center text-xl shrink-0">
                          {expense.allocation?.icon ?? '❓'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">
                            {expense.description || expense.allocation?.name || t('activity.expense')}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {expense.allocation ? (
                              <span className={`text-xs px-2 py-0.5 rounded-full ${getTypeColor(expense.allocation.type)}`}>
                                {expense.allocation.name}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {t('addExpense.unassigned')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className="text-lg font-display">€{expense.amount.toFixed(2)}</p>
                        <button
                          onClick={() => setEditing(expense)}
                          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(expense.id)}
                          disabled={deletingId === expense.id}
                          className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {deletingId === expense.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {/* FAB */}
      <motion.button
        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
        onClick={() => setShowAdd(true)}
        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center z-40 group"
      >
        <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
      </motion.button>

      <AddExpense
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={() => fetchExpenses(currentMonth)}
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
