import { useState, useRef, useCallback, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, X, GripVertical, Pencil, Trash2, CheckCircle2, RotateCcw, Banknote,
  CreditCard, Loader2, Sunrise, Route, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useDebts, type Debt } from '../hooks/useDebts';
import { usePayoffPlan, monthLabel } from '../hooks/useDebtProjection';
import { DebtFormFields, EMPTY_DEBT_FORM, debtFormFromDebt, debtPayloadFromForm, kindIcon, type DebtFormState } from './shared/DebtFormFields';
import { DebtPaymentSheet, type DebtPaymentTarget } from './shared/DebtPaymentSheet';
import { CardCycleLine } from './shared/CardCycleLine';
import { apiErrorMessage } from '../lib/apiErrors';

// What a payment of this debt usually is, to prefill the payment sheet. A card
// with a billing cycle suggests what its line shows as due (the statement, or
// the minimum due), not purchases after the cut-off.
const suggestedPayment = (d: Debt): number =>
  d.paymentMode === 'full' ? (d.cycle && d.cycle.dueAmount > 0 ? d.cycle.dueAmount : d.owed)
  : d.paymentMode === 'installments' ? d.installmentAmount ?? 0
  : d.cycle?.minimumDue ?? d.minimumPayment ?? 0;

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

export function Debts({ onOpenDebt, onOpenPlan }: { onOpenDebt: (id: string) => void; onOpenPlan: () => void }) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { debts, totalOwed, totalMinimums, loading, createDebt, updateDebt, deleteDebt, reorderDebts, fetchDebts } = useDebts();
  const currency = t('currency.symbol');
  const { user } = useAuth();

  const [paying, setPaying] = useState<DebtPaymentTarget | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<DebtFormState>(EMPTY_DEBT_FORM);
  const [saving, setSaving] = useState(false);
  const [showPaidOff, setShowPaidOff] = useState(false);

  // The payoff plan at its defaults (snowball, no extra): the same answer as
  // the plan screen (GET /api/debts/plan), re-read whenever a debt changes.
  const planKey = debts.map(d => `${d.id}:${d.status}:${d.owed}:${d.minimumPayment}:${d.installmentAmount}:${d.apr}:${d.paymentMode}`).join('|');
  const { data: plan } = usePayoffPlan({ method: 'snowball' }, planKey);

  // Local copy for drag reordering of active debts.
  const [local, setLocal] = useState<Debt[]>([]);
  useEffect(() => { setLocal(debts); }, [debts]);

  const localRef = useRef(local);
  localRef.current = local;

  const active = local.filter(d => d.status === 'active');
  const paidOff = local.filter(d => d.status !== 'active');

  const freedom = plan?.plan?.converged ? plan.plan : null;
  const debtFreeLabel = freedom?.payoffMonth ? monthLabel(freedom.payoffMonth, locale) : null;

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

  const openCreate = () => { setForm(EMPTY_DEBT_FORM); setShowForm(true); };
  const openEdit = (d: Debt) => { setForm(debtFormFromDebt(d)); setShowForm(true); };

  const openPay = (d: Debt) => setPaying({
    debtId: d.id, name: d.name, owed: d.owed, suggested: suggestedPayment(d), cardAccountId: d.accountId,
  });

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error(t('debts.nameRequired')); return; }
    setSaving(true);
    const payload = debtPayloadFromForm(form);
    const result = form.id
      ? await updateDebt(form.id, payload)
      : await createDebt(payload);
    setSaving(false);
    if (result.error) { toast.error(apiErrorMessage(t, result)); return; }
    toast.success(form.id ? t('debts.savedOk') : t('debts.createdOk'));
    setShowForm(false);
    setForm(EMPTY_DEBT_FORM);
  };

  const handleTogglePaidOff = async (d: Debt) => {
    const result = await updateDebt(d.id, { status: d.status === 'active' ? 'paid_off' : 'active' });
    if (result.error) toast.error(apiErrorMessage(t, result));
    else toast.success(d.status === 'active' ? t('debts.markedPaidOff') : t('debts.reactivatedOk'));
  };

  const handleDelete = async (d: Debt) => {
    const result = await deleteDebt(d.id);
    if (result.error) toast.error(apiErrorMessage(t, result));
    else toast.success(t('debts.deletedOk'));
  };

  const renderRow = (d: Debt, handleRef?: React.RefObject<HTMLDivElement>) => {
    const Icon = kindIcon(d.kind);
    const progress = d.installmentsTotal
      ? `${d.installmentsPaid}/${d.installmentsTotal}`
      : null;
    return (
      <div className="bg-card border border-border rounded-3xl p-5 flex items-center gap-4">
        {handleRef && (
          <div
            ref={handleRef}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 touch-none select-none"
            title={t('debts.dragToReorder')}
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        {/* Tapping the debt opens its detail (LPBETA-02). */}
        <button
          onClick={() => onOpenDebt(d.id)}
          title={t('debtDetail.open', { name: d.name })}
          className="flex-1 min-w-0 flex items-center gap-4 text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
        <div className="w-11 h-11 rounded-2xl bg-surface-sunk flex items-center justify-center text-muted-foreground shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{d.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`debts.kind.${d.kind}`)} · {t(`debts.paymentMode.${d.paymentMode}`)}
            {d.apr != null && ` · ${t('debts.aprShort', { apr: d.apr })}`}
            {progress && ` · ${progress} ${t('debts.installments')}`}
          </p>
          {d.purchasesTotal > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('debts.previousAndPurchases', { previous: fmtEuro(d.previousBalance), purchases: fmtEuro(d.purchasesTotal) })}
            </p>
          )}
          {d.cycle && <CardCycleLine cycle={d.cycle} fmt={fmtEuro} locale={locale} />}
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-semibold tabular-nums">{fmtEuro(d.owed)}</p>
          {d.monthlyCommitment > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {fmtEuro(d.monthlyCommitment)} {t('debts.perPeriod')}
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {d.status === 'active' && (
            <button onClick={() => openPay(d)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-pool-soft transition-colors" title={t('debts.recordPayment')} aria-label={t('debts.recordPayment')}>
              <Banknote className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          {/* Another member's shared debt is read-only (the server answers 403). */}
          {d.ownerUserId === user?.id && (
            <>
              <button onClick={() => openEdit(d)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors" title={t('debts.edit')} aria-label={t('debts.edit')}>
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
              <button onClick={() => handleTogglePaidOff(d)} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors" title={d.status === 'active' ? t('debts.markPaidOff') : t('debts.reactivate')} aria-label={d.status === 'active' ? t('debts.markPaidOff') : t('debts.reactivate')}>
                {d.status === 'active' ? <CheckCircle2 className="w-4 h-4 text-reed" /> : <RotateCcw className="w-4 h-4 text-muted-foreground" />}
              </button>
              {d.status !== 'active' && (
                <button onClick={() => handleDelete(d)} className="w-10 h-10 flex items-center justify-center rounded-xl border border-destructive/30 text-destructive hover:bg-alert-soft transition-colors" title={t('debts.delete')} aria-label={t('debts.delete')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Page title */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="space-y-2">
        <h1 className="text-4xl tracking-tight font-display">{t('debts.title')}</h1>
        <p className="text-muted-foreground">{t('debts.subtitle')}</p>
      </motion.div>

      {/* Everything owed in one place, and the answer people want: when it ends.
          Calm, not alarming (LPBETA-27): owing money is not an error. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-8 space-y-6"
      >
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('debts.totalOwed')}</p>
            <p className="text-5xl font-display tabular-nums">{fmtEuro(totalOwed)}</p>
            <p className="text-sm text-muted-foreground">{t('debts.totalOwedHint', { count: active.length })}</p>
          </div>
          <div className="space-y-1 sm:border-l sm:border-border sm:pl-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('debts.committedPerPeriod')}</p>
            <p className="text-2xl font-display tabular-nums">{fmtEuro(totalMinimums)}</p>
            <p className="text-sm text-muted-foreground">{t('debts.committedHint')}</p>
          </div>
        </div>
        {debtFreeLabel && (
          <p className="inline-flex items-center gap-2 bg-sun-soft text-sun-ink rounded-full px-4 py-2 text-sm font-medium">
            <Sunrise className="w-4 h-4 shrink-0" />
            {t('debts.debtFreeBy', { date: debtFreeLabel })}
          </p>
        )}
      </motion.div>

      {loading ? (
        <div className="bg-card border border-border rounded-3xl p-6 h-24 animate-pulse" />
      ) : active.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 bg-pool-soft text-pool rounded-3xl flex items-center justify-center mx-auto">
            <CreditCard className="w-8 h-8" />
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

      {/* Payoff plan: a compact summary; the whole plan has its own screen. */}
      {active.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-card border border-border rounded-3xl p-6 space-y-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-display">{t('debts.payoffTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('debts.payoffSubtitle')}</p>
            </div>
            <button onClick={onOpenPlan} className="px-4 py-2 border border-border rounded-xl hover:bg-muted transition-colors text-sm inline-flex items-center gap-2 shrink-0">
              <Route className="w-4 h-4" />{t('payoffPlan.open')}
            </button>
          </div>
          {freedom?.payoffMonth ? (
            <p className="text-sm">
              {t('debts.planSummary', {
                method: t('debts.method.snowball'),
                date: monthLabel(freedom.payoffMonth, locale),
                months: t('debtDetail.monthsCount', { count: freedom.months }),
                interest: fmtEuro(freedom.totalInterestPaid),
              })}
            </p>
          ) : plan?.plan ? (
            <p className="text-sm text-muted-foreground">{t('payoffPlan.neverEnds')}</p>
          ) : plan && plan.excluded.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t('debts.planNeedsData')}</p>
          ) : null}
          {plan?.plan && plan.excluded.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('debts.planExcluded', { count: plan.excluded.length })}</p>
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
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.2, ease: 'easeOut' }}
        onClick={openCreate}
        aria-label={t('debts.newTitle')}
        style={{ right: 'calc(1.5rem + env(safe-area-inset-right, 0px))', bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        className="fixed w-16 h-16 bg-primary text-primary-foreground rounded-full shadow-soft hover:-translate-y-0.5 transition-transform flex items-center justify-center z-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Plus className="w-7 h-7" />
      </motion.button>

      {/* Create / edit modal */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="bg-card border border-border rounded-3xl shadow-soft p-6 w-full max-w-md space-y-5 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{form.id ? t('debts.editTitle') : t('debts.newTitle')}</h2>
                <button onClick={() => setShowForm(false)} aria-label={t('debts.close')} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <DebtFormFields form={form} setForm={setForm} />

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full h-12 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {form.id ? t('debts.save') : t('debts.createAction')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DebtPaymentSheet target={paying} onClose={() => setPaying(null)} onPaid={fetchDebts} />
    </div>
  );
}
