import { useState, useRef, useCallback, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, X, GripVertical, Pencil, Trash2, CheckCircle2, RotateCcw, Banknote,
  CreditCard, Calendar, Car, ShoppingBag, AlertCircle, Wallet, Loader2, TrendingDown, Flame, Target, Home, GraduationCap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useDebts, type Debt, type DebtKind, type DebtPaymentMode, type PayoffSummary } from '../hooks/useDebts';
import { useAccounts } from '../hooks/useAccounts';

const DEBT_KINDS: DebtKind[] = ['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan', 'student_loan', 'mortgage', 'other'];
const CARD_LIKE: Set<DebtKind> = new Set(['credit_card']);
const PAYMENT_MODES: DebtPaymentMode[] = ['full', 'installments', 'minimum'];

// A new card defaults to "paid in full at month end" (the common Spanish
// card); everything else to fixed installments.
const defaultModeFor = (kind: DebtKind): DebtPaymentMode =>
  kind === 'credit_card' ? 'full' : kind === 'other' ? 'minimum' : 'installments';

// What a payment of this debt usually is, to prefill the payment sheet.
const suggestedPayment = (d: Debt): number =>
  d.paymentMode === 'full' ? Math.max(0, d.currentBalance)
  : d.paymentMode === 'installments' ? d.installmentAmount ?? 0
  : d.minimumPayment ?? 0;

// The user's local calendar day (toISOString would be UTC: yesterday in Spain
// between midnight and 2am, landing a payment in the previous period).
const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

function kindIcon(kind: DebtKind) {
  switch (kind) {
    case 'credit_card': return CreditCard;
    case 'installment':  return Calendar;
    case 'bnpl':          return ShoppingBag;
    case 'payday_loan':  return AlertCircle;
    case 'auto_loan':    return Car;
    case 'student_loan': return GraduationCap;
    case 'mortgage':      return Home;
    default:              return Wallet;
  }
}

const DRAG_TYPE = 'DEBT_ROW';
interface DragItem { id: string; index: number }

function DraggableRow({
  id, index, moveRow, onDragEnd, children,
}: {
  id: string;
  index: number;
  moveRow: (from: number, to: number) => void;
  onDragEnd: () => void;
  children: (handleRef: React.RefObject<HTMLDivElement>) => React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
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
      className={`transition-opacity rounded-2xl ${isDragging ? 'opacity-40' : 'opacity-100'} ${isOver ? 'ring-2 ring-primary/20' : ''}`}
    >
      {children(handleRef)}
    </div>
  );
}

interface FormState {
  id: string | null;
  name: string;
  kind: DebtKind;
  paymentMode: DebtPaymentMode;
  currentBalance: string;
  apr: string;
  creditLimit: string;
  paymentDueDay: string;
  minimumPayment: string;
  installmentAmount: string;
  installmentsTotal: string;
  installmentsPaid: string;
  // As loaded when editing: live values are only sent if the user changed
  // them, so a form left open can't erase a payment recorded meanwhile.
  loadedBalance: string;
  loadedInstallmentsPaid: string;
}

const EMPTY_FORM: FormState = {
  id: null, name: '', kind: 'credit_card', paymentMode: 'full', currentBalance: '', apr: '', creditLimit: '',
  paymentDueDay: '', minimumPayment: '', installmentAmount: '', installmentsTotal: '', installmentsPaid: '',
  loadedBalance: '', loadedInstallmentsPaid: '',
};

export function Debts() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { debts, totalOwed, totalMinimums, loading, createDebt, updateDebt, deleteDebt, reorderDebts, fetchPayoff, recordPayment } = useDebts();
  const { accounts } = useAccounts();
  const currency = t('currency.symbol');

  // Payment sheet
  const [paying, setPaying] = useState<Debt | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payDate, setPayDate] = useState(today());
  const [savingPayment, setSavingPayment] = useState(false);
  // A card is paid from a bank account, never from itself.
  const payFromAccounts = accounts.filter(a => !a.isArchived && a.type !== 'card' && a.id !== paying?.accountId);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showPaidOff, setShowPaidOff] = useState(false);

  // Payoff planner — snowball vs avalanche comparison for the active debts.
  const [extraPayment, setExtraPayment] = useState('0');
  const [payoff, setPayoff] = useState<{ snowball: PayoffSummary | null; avalanche: PayoffSummary | null } | null>(null);
  const [loadingPayoff, setLoadingPayoff] = useState(false);

  const loadPayoff = useCallback(async (extra: number) => {
    setLoadingPayoff(true);
    const result = await fetchPayoff(extra);
    setPayoff(result);
    setLoadingPayoff(false);
  }, [fetchPayoff]);

  useEffect(() => {
    if (debts.filter(d => d.status === 'active').length > 0) loadPayoff(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debts.length]);

  // Local copy for drag reordering of active debts.
  const [local, setLocal] = useState<Debt[]>([]);
  useEffect(() => { setLocal(debts); }, [debts]);

  const localRef = useRef(local);
  localRef.current = local;

  const active = local.filter(d => d.status === 'active');
  const paidOff = local.filter(d => d.status !== 'active');

  const fmtEuro = (v: number) =>
    `${currency}${v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const moveRow = useCallback((from: number, to: number) => {
    setLocal(prev => {
      const activeItems = prev.filter(d => d.status === 'active');
      const moved = activeItems[from];
      const target = activeItems[to];
      if (!moved || !target) return prev;
      const next = [...prev];
      const fromAbs = next.indexOf(moved);
      const toAbs = next.indexOf(target);
      next.splice(fromAbs, 1);
      next.splice(toAbs, 0, moved);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    const order = localRef.current
      .filter(d => d.status === 'active')
      .map((item, index) => ({ id: item.id, sortOrder: index }));
    reorderDebts(order);
  }, [reorderDebts]);

  const openCreate = () => { setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (d: Debt) => {
    setForm({
      id: d.id,
      name: d.name,
      kind: d.kind,
      paymentMode: d.paymentMode,
      currentBalance: String(d.currentBalance),
      apr: d.apr != null ? String(d.apr) : '',
      creditLimit: d.creditLimit != null ? String(d.creditLimit) : '',
      paymentDueDay: d.paymentDueDay != null ? String(d.paymentDueDay) : '',
      minimumPayment: d.minimumPayment != null ? String(d.minimumPayment) : '',
      installmentAmount: d.installmentAmount != null ? String(d.installmentAmount) : '',
      installmentsTotal: d.installmentsTotal != null ? String(d.installmentsTotal) : '',
      installmentsPaid: String(d.installmentsPaid ?? 0),
      loadedBalance: String(d.currentBalance),
      loadedInstallmentsPaid: String(d.installmentsPaid ?? 0),
    });
    setShowForm(true);
  };

  const isCardLike = CARD_LIKE.has(form.kind);
  const isInstallments = form.paymentMode === 'installments';
  const isMinimum = form.paymentMode === 'minimum';

  const openPay = (d: Debt) => {
    setPaying(d);
    setPayAmount(String(suggestedPayment(d) || ''));
    setPayAccountId(accounts.find(a => !a.isArchived && a.type !== 'card' && a.id !== d.accountId)?.id ?? '');
    setPayDate(today());
  };

  const handlePay = async () => {
    const amount = parseFloat(payAmount);
    if (!paying || !amount || amount <= 0 || !payAccountId) return;
    setSavingPayment(true);
    const result = await recordPayment(paying, {
      amount, accountId: payAccountId, date: payDate,
      description: t('debts.paymentDescription', { name: paying.name }),
    });
    setSavingPayment(false);
    if (result.code) {
      toast.error(t(result.code === 'paid_from_card' ? 'debts.paidFromCardError' : 'debts.paymentFailed'));
      return;
    }
    toast.success(t('debts.paidOk'));
    setPaying(null);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error(t('debts.nameRequired')); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      paymentMode: form.paymentMode,
      ...((!form.id || form.currentBalance !== form.loadedBalance) && { currentBalance: parseFloat(form.currentBalance) || 0 }),
      apr: form.apr ? parseFloat(form.apr) : null,
      creditLimit: isCardLike && form.creditLimit ? parseFloat(form.creditLimit) : null,
      paymentDueDay: form.paymentDueDay ? parseInt(form.paymentDueDay, 10) : null,
      minimumPayment: isMinimum && form.minimumPayment ? parseFloat(form.minimumPayment) : null,
      installmentAmount: isInstallments && form.installmentAmount ? parseFloat(form.installmentAmount) : null,
      installmentsTotal: isInstallments && form.installmentsTotal ? parseInt(form.installmentsTotal, 10) : null,
      ...(isInstallments && (!form.id || form.installmentsPaid !== form.loadedInstallmentsPaid)
        && { installmentsPaid: parseInt(form.installmentsPaid, 10) || 0 }),
    };
    const result = form.id
      ? await updateDebt(form.id, payload)
      : await createDebt(payload);
    setSaving(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(form.id ? t('debts.savedOk') : t('debts.createdOk'));
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const handleTogglePaidOff = async (d: Debt) => {
    const result = await updateDebt(d.id, { status: d.status === 'active' ? 'paid_off' : 'active' });
    if (result.error) toast.error(result.error);
    else toast.success(d.status === 'active' ? t('debts.markedPaidOff') : t('debts.reactivatedOk'));
  };

  const handleDelete = async (d: Debt) => {
    const result = await deleteDebt(d.id);
    if (result.error) toast.error(result.code === 'debt_has_payments' ? t('debts.hasPaymentsError') : result.error);
    else toast.success(t('debts.deletedOk'));
  };

  const renderRow = (d: Debt, handleRef?: React.RefObject<HTMLDivElement>) => {
    const Icon = kindIcon(d.kind);
    const progress = d.installmentsTotal
      ? `${d.installmentsPaid}/${d.installmentsTotal}`
      : null;
    return (
      <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
        {handleRef && (
          <div
            ref={handleRef}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 touch-none select-none"
            title={t('debts.dragToReorder')}
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-destructive/10 to-primary/10 flex items-center justify-center text-destructive shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display truncate">{d.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`debts.kind.${d.kind}`)} · {t(`debts.paymentMode.${d.paymentMode}`)}
            {d.apr != null && ` · ${d.apr}% APR`}
            {progress && ` · ${progress} ${t('debts.installments')}`}
          </p>
          {d.purchasesTotal > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('debts.previousAndPurchases', { previous: fmtEuro(d.previousBalance), purchases: fmtEuro(d.purchasesTotal) })}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-lg font-display text-destructive">{fmtEuro(Math.max(0, d.currentBalance))}</p>
          {d.monthlyCommitment > 0 && (
            <p className="text-xs text-muted-foreground">
              {fmtEuro(d.monthlyCommitment)} {t('debts.perPeriod')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {d.status === 'active' && (
            <button onClick={() => openPay(d)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={t('debts.recordPayment')}>
              <Banknote className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          <button onClick={() => openEdit(d)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={t('debts.edit')}>
            <Pencil className="w-4 h-4 text-muted-foreground" />
          </button>
          <button onClick={() => handleTogglePaidOff(d)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={d.status === 'active' ? t('debts.markPaidOff') : t('debts.reactivate')}>
            {d.status === 'active' ? <CheckCircle2 className="w-4 h-4 text-muted-foreground" /> : <RotateCcw className="w-4 h-4 text-muted-foreground" />}
          </button>
          {d.status !== 'active' && (
            <button onClick={() => handleDelete(d)} className="p-2 rounded-lg border border-destructive/20 text-destructive hover:bg-destructive/5 transition-colors" title={t('debts.delete')}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Page title */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <h1 className="text-4xl tracking-tight">{t('debts.title')}</h1>
        <p className="text-muted-foreground">{t('debts.subtitle')}</p>
      </motion.div>

      {/* Consolidated hero — the differentiator: everything owed, in one place */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-gradient-to-br from-destructive to-destructive/80 text-white rounded-3xl p-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
        <div className="relative z-10 grid grid-cols-2 gap-6">
          <div>
            <p className="text-sm opacity-75 mb-1">{t('debts.totalOwed')}</p>
            <p className="text-4xl font-display">{fmtEuro(totalOwed)}</p>
            <p className="text-xs opacity-60 mt-2">{t('debts.totalOwedHint', { count: active.length })}</p>
          </div>
          <div className="border-l border-white/20 pl-6">
            <p className="text-sm opacity-75 mb-1">{t('debts.committedPerPeriod')}</p>
            <p className="text-4xl font-display">{fmtEuro(totalMinimums)}</p>
            <p className="text-xs opacity-60 mt-2">{t('debts.committedHint')}</p>
          </div>
        </div>
      </motion.div>

      {loading ? (
        <div className="bg-card border border-border rounded-2xl p-6 h-24 animate-pulse" />
      ) : active.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto">
            <CreditCard className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="font-display text-lg">{t('debts.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('debts.emptyDesc')}</p>
        </div>
      ) : (
        <DndProvider backend={HTML5Backend}>
          <div className="space-y-3">
            {active.map((d, index) => (
              <DraggableRow key={d.id} id={d.id} index={index} moveRow={moveRow} onDragEnd={handleDragEnd}>
                {(handleRef) => renderRow(d, handleRef)}
              </DraggableRow>
            ))}
          </div>
        </DndProvider>
      )}

      {/* Payoff planner — snowball vs avalanche */}
      {active.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-2xl p-6 space-y-5"
        >
          <div>
            <h2 className="text-xl font-display">{t('debts.payoffTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('debts.payoffSubtitle')}</p>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-muted-foreground shrink-0">{t('debts.extraPaymentLabel')}</label>
            <div className="relative flex-1 max-w-40">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
              <input
                type="number"
                min={0}
                value={extraPayment}
                onChange={e => setExtraPayment(e.target.value)}
                onBlur={() => loadPayoff(parseFloat(extraPayment) || 0)}
                onKeyDown={e => { if (e.key === 'Enter') loadPayoff(parseFloat(extraPayment) || 0); }}
                className="w-full pl-8 pr-4 py-2.5 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
              />
            </div>
            {loadingPayoff && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>

          {payoff?.snowball && payoff?.avalanche && (
            <div className="grid sm:grid-cols-2 gap-4">
              {([
                { method: 'snowball' as const, icon: Flame, summary: payoff.snowball },
                { method: 'avalanche' as const, icon: TrendingDown, summary: payoff.avalanche },
              ]).map(({ method, icon: Icon, summary }) => {
                const isBetter = payoff.snowball && payoff.avalanche
                  && summary.totalInterestPaid <= Math.min(payoff.snowball.totalInterestPaid, payoff.avalanche.totalInterestPaid);
                return (
                  <div key={method} className={`rounded-2xl border-2 p-5 ${isBetter ? 'border-primary bg-primary/5' : 'border-border'}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className="w-4 h-4 text-primary" />
                      <p className="font-display">{t(`debts.method.${method}`)}</p>
                      {isBetter && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground">{t('debts.lessInterest')}</span>}
                    </div>
                    <p className="text-2xl font-display">{summary.months} <span className="text-sm text-muted-foreground">{t('debts.monthsToDebtFree')}</span></p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('debts.totalInterest')}: {fmtEuro(Math.round(summary.totalInterestPaid))}
                    </p>
                    {summary.payoffOrder.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border space-y-1">
                        {summary.payoffOrder.map((p, i) => (
                          <div key={p.id} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="flex items-center gap-1.5"><Target className="w-3 h-3" />{i + 1}. {p.name}</span>
                            <span>{t('debts.month', { count: p.monthPaidOff })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      )}

      {/* Paid off */}
      {paidOff.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowPaidOff(v => !v)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPaidOff ? t('debts.hidePaidOff') : t('debts.showPaidOff', { count: paidOff.length })}
          </button>
          <AnimatePresence>
            {showPaidOff && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="space-y-3 opacity-70"
              >
                {paidOff.map((d) => <div key={d.id}>{renderRow(d)}</div>)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* FAB */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
        onClick={openCreate}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center z-40 group"
      >
        <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
      </motion.button>

      {/* Create / edit modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{form.id ? t('debts.editTitle') : t('debts.newTitle')}</h2>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Name */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.nameLabel')}</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('debts.namePlaceholder')}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                />
              </div>

              {/* Kind */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.kindLabel')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {DEBT_KINDS.map(k => {
                    const Icon = kindIcon(k);
                    const selected = form.kind === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setForm(f => ({ ...f, kind: k, ...(!f.id && { paymentMode: defaultModeFor(k) }) }))}
                        className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-colors text-xs ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
                      >
                        <Icon className="w-4 h-4" />
                        {t(`debts.kind.${k}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* How it's paid */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.paymentModeLabel')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_MODES.map(m => (
                    <button
                      key={m}
                      onClick={() => setForm(f => ({ ...f, paymentMode: m }))}
                      className={`py-3 rounded-xl border transition-colors text-xs ${form.paymentMode === m ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
                    >
                      {t(`debts.paymentMode.${m}`)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{t(`debts.paymentModeHint.${form.paymentMode}`)}</p>
              </div>

              {/* Current balance — editing it moves the anchor (server/lib/debtBalance.ts) */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.balanceLabel')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={form.currentBalance}
                    onChange={e => setForm(f => ({ ...f, currentBalance: e.target.value }))}
                    placeholder="0"
                    className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {form.id ? t('debts.balanceAdjustHint') : isCardLike ? t('debts.cardPurchasesHint') : t('debts.balanceNewHint')}
                </p>
              </div>

              {/* APR (all kinds) */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.aprLabel')}</label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={form.apr}
                    onChange={e => setForm(f => ({ ...f, apr: e.target.value }))}
                    placeholder="0.0"
                    className="w-full pr-8 pl-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                </div>
              </div>

              {isCardLike && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('debts.creditLimitLabel')}</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={form.creditLimit}
                    onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                  />
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.paymentDueDayLabel')}</label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={form.paymentDueDay}
                  onChange={e => setForm(f => ({ ...f, paymentDueDay: e.target.value }))}
                  placeholder="1-28"
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                />
              </div>

              {isMinimum && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('debts.minimumPaymentLabel')}</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={form.minimumPayment}
                      onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))}
                      placeholder="0"
                      className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
                    />
                  </div>
                </div>
              )}

              {isInstallments && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">{t('debts.installmentAmountLabel')}</label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={form.installmentAmount}
                        onChange={e => setForm(f => ({ ...f, installmentAmount: e.target.value }))}
                        placeholder="0"
                        className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">{t('debts.installmentsTotalLabel')}</label>
                      <input
                        type="number"
                        value={form.installmentsTotal}
                        onChange={e => setForm(f => ({ ...f, installmentsTotal: e.target.value }))}
                        placeholder="12"
                        className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                      />
                      <div className="flex gap-1">
                        {[6, 10, 12, 24].map(n => (
                          <button
                            key={n}
                            onClick={() => setForm(f => ({ ...f, installmentsTotal: String(n) }))}
                            className={`flex-1 py-1 rounded-lg border text-[11px] transition-colors ${form.installmentsTotal === String(n) ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('debts.installmentsPaidLabel')}</label>
                    <input
                      type="number"
                      value={form.installmentsPaid}
                      onChange={e => setForm(f => ({ ...f, installmentsPaid: e.target.value }))}
                      placeholder="0"
                      className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                    />
                  </div>
                </>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {form.id ? t('debts.save') : t('debts.createAction')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Payment sheet */}
      <AnimatePresence>
        {paying && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setPaying(null); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-display">{t('debts.payTitle')}</h2>
                  <p className="text-sm text-muted-foreground">{paying.name} · {fmtEuro(Math.max(0, paying.currentBalance))}</p>
                </div>
                <button onClick={() => setPaying(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.payAmountLabel')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={payAmount}
                    onChange={e => setPayAmount(e.target.value)}
                    placeholder="0"
                    className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.payFromLabel')}</label>
                {payFromAccounts.length === 0 ? (
                  <p className="text-sm text-amber-700 dark:text-amber-500">{t('debts.noPayFromAccount')}</p>
                ) : (
                  <select
                    value={payAccountId}
                    onChange={e => setPayAccountId(e.target.value)}
                    className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                  >
                    {payFromAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.payDateLabel')}</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={e => setPayDate(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                />
              </div>

              <button
                onClick={handlePay}
                disabled={savingPayment || !payAccountId || !(parseFloat(payAmount) > 0)}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {savingPayment && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('debts.recordPayment')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
