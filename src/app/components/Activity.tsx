import { useState, useMemo } from 'react';
import { Plus, X, TrendingDown, TrendingUp, Trash2, Loader2, Waves, Pencil, Wand2, Copy, Upload, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useExpenses, type Expense } from '../hooks/useExpenses';
import { useIncome, type Income } from '../hooks/useIncome';
import { useAllocations } from '../hooks/useAllocations';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useMonth, monthLabel } from '../context/MonthContext';
import { useDuplicates } from '../hooks/useDuplicates';
import { AddExpense } from './AddExpense';
import { AddIncome } from './AddIncome';
import { EditExpense } from './EditExpense';
import { RulesManager } from './RulesManager';
import { Duplicates } from './Duplicates';
import { ImportStatement } from './ImportStatement';
import { DebtPaymentSheet, type DebtPaymentTarget } from './shared/DebtPaymentSheet';
import { useAccounts } from '../hooks/useAccounts';
import { useMoney } from '../onboarding/useMoney';
import { BankStrip } from './banking/BankStrip';

type Movement =
  | { kind: 'expense'; id: string; date: string; amount: number; expense: Expense }
  | { kind: 'income'; id: string; date: string; amount: number; income: Income };

// Category chips: calm and neutral, the line's own icon carries the identity
// (LPBETA-27). Savings lines get the brand tint so "money for you" stands out.
function getTypeColor(type: string) {
  switch (type) {
    case 'investment':
    case 'plan':       return 'bg-pool-soft text-pool';
    case 'generosity': return 'bg-sun-soft text-sun-ink';
    default:           return 'bg-muted text-muted-foreground';
  }
}


export function Activity({ onAddExpense: _onAddExpense }: { onAddExpense?: () => void }) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';

  const { selectedMonth: currentMonth, isCurrentMonth, isFutureMonth } = useMonth();
  const [filterAllocationId, setFilterAllocationId] = useState<string | 'all'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  // Paying a card is a movement of the month too: bank → card, partial or full.
  const { accounts, fetchAccounts } = useAccounts();
  const cardChoices: DebtPaymentTarget[] = accounts
    .filter(a => a.card && !a.isArchived)
    .map(a => ({ debtId: a.card!.debtId, name: a.name, owed: a.card!.owed, suggested: a.card!.owed, cardAccountId: a.id }));
  const [payingCard, setPayingCard] = useState<DebtPaymentTarget | null>(null);
  const [showAddIncome, setShowAddIncome] = useState(false);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);

  const { expenses, loading, totalSpent, totalByAllocation, deleteExpense, updateExpense, updateAttribution, fetchExpenses } =
    useExpenses(currentMonth);
  const { incomes, totalIncome, deleteIncome, fetchIncomes } = useIncome(currentMonth);
  const { user } = useAuth();
  const { groups: duplicateGroups, loading: duplicatesLoading, merge: mergeDuplicates, dismiss: dismissDuplicates, fetchDuplicates } = useDuplicates();
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
      {/* Header: title, the month being shown, and the two secondary tools */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground capitalize flex items-center gap-2">
            {monthLabel(currentMonth, locale)}
            {isFutureMonth && (
              <span className="normal-case tracking-normal font-medium text-sun-ink bg-sun-soft px-2 py-0.5 rounded-full">
                {t('monthlyReview.nextMonth')}
              </span>
            )}
          </p>
          <h1 className="text-4xl tracking-tight font-display">{t('activity.title')}</h1>
          <p className="text-muted-foreground">{t('activity.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowImport(true)}
            className="h-11 px-4 border border-line-strong rounded-xl hover:bg-muted transition-colors text-sm font-medium flex items-center gap-2"
          >
            <Upload className="w-4 h-4" /> {t('import.button')}
          </button>
          <button
            onClick={() => setShowRules(true)}
            className="h-11 px-4 border border-line-strong rounded-xl hover:bg-muted transition-colors text-sm font-medium flex items-center gap-2"
          >
            <Wand2 className="w-4 h-4" /> {t('rules.manageButton')}
          </button>
        </div>
      </motion.div>

      {/* Bank: connect, review what's held, reconnect — or just when it last synced */}
      <BankStrip onChanged={() => { fetchExpenses(currentMonth); fetchIncomes(currentMonth); fetchAccounts(); fetchDuplicates(); }} />

      {/* One summary card: what went out this month, and where most of it went */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-6 space-y-4"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('activity.totalSpent')}</p>
            <p className="text-4xl font-display tabular-nums">{fmt(totalSpent)}</p>
            <p className="text-sm text-muted-foreground">
              {t('activity.movementsCount', { count: expenses.length })} · {t('activity.avgPerDay', { amount: fmt(avgPerDay) })}
            </p>
          </div>
          {totalIncome > 0 && (
            <div className="space-y-1 text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('activity.incomeLabel')}</p>
              <p className="text-2xl font-display tabular-nums text-reed">+{fmt(totalIncome)}</p>
            </div>
          )}
        </div>
        {monthlyIncome > 0 && (
          <div className="space-y-1.5">
            <div className="h-2 bg-surface-sunk rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(budgetUsedPct)} aria-valuemin={0} aria-valuemax={100} aria-label={t('activity.pctOfIncome')}>
              <div className="h-full bg-primary rounded-full transition-[width] duration-500 ease-out" style={{ width: `${budgetUsedPct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{budgetUsedPct.toFixed(0)}% {t('activity.pctOfIncome')}</p>
          </div>
        )}
        {topAllocation && (
          <p className="text-sm border-t border-border pt-4 flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground shrink-0">{t('activity.topCategory')}</span>
            <span className="shrink-0">{topAllocation.icon}</span>
            <span className="font-medium truncate">{topAllocation.name}</span>
            <span className="ml-auto tabular-nums shrink-0">{fmt(topAllocation.amount)}</span>
          </p>
        )}
      </motion.div>

      {/* Allocation filter chips */}
      {allocations.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}
          className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1"
        >
          <button
            onClick={() => setFilterAllocationId('all')}
            className={`h-10 px-4 rounded-full text-sm whitespace-nowrap transition-colors ${
              filterAllocationId === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card border border-line-strong hover:bg-muted'
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
                className={`h-10 px-4 rounded-full text-sm whitespace-nowrap flex items-center gap-2 transition-colors ${
                  filterAllocationId === a.id ? 'bg-primary text-primary-foreground' : 'bg-card border border-line-strong hover:bg-muted'
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
              className={`h-10 px-4 rounded-full text-sm whitespace-nowrap transition-colors ${
                filterAllocationId === '__unassigned__' ? 'bg-primary text-primary-foreground' : 'bg-card border border-line-strong hover:bg-muted'
              }`}
            >
              {t('activity.unassigned', { count: expenses.filter(e => !e.allocationId).length })}
            </button>
          )}
        </motion.div>
      )}

      {/* Possible duplicates banner */}
      {duplicateGroups.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-sun-soft text-sun-ink rounded-2xl px-5 py-4"
        >
          <Copy className="w-5 h-5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{t('duplicates.bannerTitle', { count: duplicateGroups.length })}</p>
            <p className="text-sm text-foreground/80">{t('duplicates.bannerDesc')}</p>
          </div>
          <button
            onClick={() => setShowDuplicates(true)}
            className="h-10 px-4 rounded-xl bg-card text-foreground border border-line-strong text-sm font-medium hover:bg-muted transition-colors shrink-0"
          >
            {t('duplicates.review')}
          </button>
        </motion.div>
      )}

      {/* Movements list (expenses + income) */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : movements.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}
          className="text-center py-16 px-6 space-y-3"
        >
          <div className="w-16 h-16 bg-pool-soft text-pool rounded-3xl flex items-center justify-center mx-auto">
            <Waves className="w-8 h-8" />
          </div>
          <p className="font-display text-lg">{t('activity.noMovements')}</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {filterAllocationId === 'all'
              ? t('activity.addFirstMovement')
              : t('activity.noExpensesInCategory')}
          </p>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.2, ease: 'easeOut' }}
          className="space-y-6"
        >
          {grouped.map(([day, dayItems], groupIdx) => {
            // Spending counts as the server says (budgetAmount): a refund
            // adds back, a card payment only its pre-existing-debt part.
            const net = dayItems.reduce((s, m) => m.kind === 'income' ? s + m.amount : s - (m.expense.budgetAmount ?? m.amount), 0);
            return (
            <div key={day}>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-sm font-medium text-muted-foreground">{formatDateLabel(day)}</p>
                <p className={`text-sm tabular-nums ${net > 0 ? 'text-reed font-medium' : 'text-muted-foreground'}`}>
                  {net > 0 ? '+' : net < 0 ? '−' : ''}{fmt(Math.abs(net))}
                </p>
              </div>
              <div className="bg-card border border-border rounded-3xl overflow-hidden divide-y divide-border">
                <AnimatePresence initial={false}>
                  {dayItems.map((m, idx) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ delay: Math.min(groupIdx * 0.03 + idx * 0.015, 0.3), duration: 0.18 }}
                      className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition-colors gap-3"
                    >
                      {m.kind === 'expense' ? (
                        <>
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 bg-surface-sunk rounded-2xl flex items-center justify-center text-xl shrink-0">
                              {m.expense.allocation?.icon ?? <Waves className="w-5 h-5 text-muted-foreground" />}
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
                                {m.expense.kind === 'refund' && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-reed-soft text-reed">
                                    {t('activity.refund')}
                                  </span>
                                )}
                                {m.expense.account && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    {m.expense.account.name}
                                  </span>
                                )}
                                {m.expense.scope === 'shared' && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-pool-soft text-pool">
                                    {m.expense.payerName
                                      ? t('activity.sharedPaidBy', { name: m.expense.payerName })
                                      : t('activity.shared')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {m.expense.kind === 'refund'
                              ? <p className="text-base font-semibold tabular-nums text-reed">+{fmt(m.amount)}</p>
                              : <p className="text-base font-semibold tabular-nums">{fmt(m.amount)}</p>}
                            <button
                              onClick={() => setEditing(m.expense)}
                              aria-label={t('activity.editMovement')}
                              className="w-10 h-10 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-pool-soft rounded-xl transition-colors"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(m.id)}
                              disabled={deletingId === m.id}
                              aria-label={t('activity.deleteMovement')}
                              className="w-10 h-10 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-alert-soft rounded-xl transition-colors disabled:opacity-50"
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
                            <div className="w-11 h-11 bg-reed-soft rounded-2xl flex items-center justify-center text-reed shrink-0">
                              <TrendingUp className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {m.income.description || t(`addIncome.cat.${m.income.category}`)}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-xs px-2 py-0.5 rounded-full bg-reed-soft text-reed">
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
                            <p className="text-base font-semibold tabular-nums text-reed">+{fmt(m.amount)}</p>
                            {/* Another member's income is read-only (the server answers 403). */}
                            {m.income.ownerUserId === user?.id && (
                              <>
                                <button
                                  onClick={() => setEditingIncome(m.income)}
                                  aria-label={t('activity.editMovement')}
                              className="w-10 h-10 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-pool-soft rounded-xl transition-colors"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteIncome(m.id)}
                                  disabled={deletingId === m.id}
                                  aria-label={t('activity.deleteMovement')}
                              className="w-10 h-10 flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-alert-soft rounded-xl transition-colors disabled:opacity-50"
                                >
                                  {deletingId === m.id
                                    ? <Loader2 className="w-4 h-4 animate-spin" />
                                    : <Trash2 className="w-4 h-4" />}
                                </button>
                              </>
                            )}
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

      {/* FAB speed-dial: expense, income or paying a card (LPBETA-27: flat, calm) */}
      <div className="fixed z-40 flex flex-col items-end gap-3" style={{ right: 'calc(1.5rem + env(safe-area-inset-right, 0px))', bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}>
        <AnimatePresence>
          {fabOpen && (
            <>
              {cardChoices.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16 }}
                  onClick={() => { setFabOpen(false); setPayingCard(cardChoices[0]); }}
                  className="h-12 flex items-center gap-2 pl-4 pr-5 bg-card border border-border text-foreground rounded-full shadow-soft hover:bg-muted transition-colors text-sm font-medium"
                >
                  <CreditCard className="w-5 h-5 text-muted-foreground" /> {t('activity.payCard')}
                </motion.button>
              )}
              <motion.button
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16, delay: 0.03 }}
                onClick={() => { setFabOpen(false); setShowAddIncome(true); }}
                className="h-12 flex items-center gap-2 pl-4 pr-5 bg-card border border-border text-foreground rounded-full shadow-soft hover:bg-muted transition-colors text-sm font-medium"
              >
                <TrendingUp className="w-5 h-5 text-reed" /> {t('activity.addIncome')}
              </motion.button>
              <motion.button
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.16, delay: 0.06 }}
                onClick={() => { setFabOpen(false); setShowAdd(true); }}
                className="h-12 flex items-center gap-2 pl-4 pr-5 bg-primary text-primary-foreground rounded-full shadow-soft hover:bg-primary/90 transition-colors text-sm font-medium"
              >
                <TrendingDown className="w-5 h-5" /> {t('activity.addExpense')}
              </motion.button>
            </>
          )}
        </AnimatePresence>
        <motion.button
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.2, ease: 'easeOut' }}
          onClick={() => setFabOpen(v => !v)}
          aria-expanded={fabOpen}
          aria-label={fabOpen ? t('activity.closeAddMenu') : t('activity.openAddMenu')}
          className="w-16 h-16 bg-primary text-primary-foreground rounded-full shadow-soft hover:-translate-y-0.5 transition-transform flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {fabOpen ? <X className="w-7 h-7" /> : <Plus className="w-7 h-7" />}
        </motion.button>
      </div>

      <DebtPaymentSheet
        target={payingCard}
        choices={cardChoices}
        onClose={() => setPayingCard(null)}
        onPaid={() => { fetchExpenses(currentMonth); fetchAccounts(); }}
      />

      <AddExpense
        isOpen={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={() => { fetchExpenses(currentMonth); fetchAccounts(); }}
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
        onSaveAttribution={(payload) => updateAttribution(editing!.id, payload)}
      />

      <RulesManager isOpen={showRules} onClose={() => setShowRules(false)} />

      <Duplicates
        isOpen={showDuplicates}
        onClose={() => setShowDuplicates(false)}
        groups={duplicateGroups}
        loading={duplicatesLoading}
        onMerge={mergeDuplicates}
        onDismiss={dismissDuplicates}
        onMerged={() => { fetchExpenses(currentMonth); fetchDuplicates(); }}
      />

      <ImportStatement
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImported={() => { fetchExpenses(currentMonth); fetchIncomes(currentMonth); fetchDuplicates(); }}
      />
    </div>
  );
}
