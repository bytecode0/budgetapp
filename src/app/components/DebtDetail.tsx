import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, X, Loader2, Info, PencilLine, Banknote, ShoppingBag, RotateCcw, SlidersHorizontal, Route,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { useMoney } from '../onboarding/useMoney';
import { useDebts } from '../hooks/useDebts';
import { useDebtDetail, monthLabel, nextMonthKey, type DebtDetailData, type MissingField } from '../hooks/useDebtProjection';
import { DebtFormFields, EMPTY_DEBT_FORM, debtFormFromDebt, debtPayloadFromForm, kindIcon, type DebtFormState } from './shared/DebtFormFields';
import { apiErrorMessage } from '../lib/apiErrors';

// One debt (LPBETA-02): what's left, when it ends, its balance over time
// (real past solid, projection dashed), a simulator that is only for looking,
// and its payments and purchases. Opened by tapping a debt in Debts.

const inputClass = 'w-full h-11 border border-line-strong rounded-xl bg-background outline-none focus:border-primary text-sm tabular-nums';

function AmountInput({ id, value, onChange, currency }: { id: string; value: string; onChange: (v: string) => void; currency: string }) {
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
      <input id={id} type="number" inputMode="decimal" min={0} value={value} onChange={e => onChange(e.target.value)} className={`${inputClass} pl-8 pr-4`} />
    </div>
  );
}

const num = (v: string) => Math.max(0, parseFloat(v) || 0);

export function DebtDetail({ debtId, onBack, onOpenPlan }: { debtId: string; onBack: () => void; onOpenPlan: () => void }) {
  const { t } = useTranslation();
  const { fmt, currency, locale } = useMoney();
  const { user } = useAuth();
  const { debts, updateDebt } = useDebts();

  const [extra, setExtra] = useState('0');
  const [oneOff, setOneOff] = useState('0');
  const [oneOffMonth, setOneOffMonth] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading, failed } = useDebtDetail(debtId, { extra: num(extra), oneOff: num(oneOff), oneOffMonth }, refreshKey);

  const [form, setForm] = useState<DebtFormState>(EMPTY_DEBT_FORM);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const fullDebt = debts.find(d => d.id === debtId);

  const openEdit = () => { if (fullDebt) { setForm(debtFormFromDebt(fullDebt)); setEditing(true); } };
  const handleSave = async () => {
    if (!form.id) return;
    if (!form.name.trim()) { toast.error(t('debts.nameRequired')); return; }
    setSaving(true);
    const result = await updateDebt(form.id, debtPayloadFromForm(form));
    setSaving(false);
    if (result.error) { toast.error(apiErrorMessage(t, result)); return; }
    toast.success(t('debts.savedOk'));
    setEditing(false);
    setRefreshKey(k => k + 1);
  };

  if (!data) {
    return (
      <div className="space-y-6 pb-8">
        <BackButton onBack={onBack} label={t('debtDetail.back')} />
        {failed && !loading
          ? <p className="text-sm text-muted-foreground">{t('debtDetail.loadFailed')}</p>
          : <div className="bg-card border border-border rounded-3xl p-8 h-48 animate-pulse" />}
      </div>
    );
  }

  const { debt, projection } = data;
  const Icon = kindIcon(debt.kind);
  const isOwner = debt.ownerUserId === user?.id;
  const base = projection.base;
  const sim = projection.simulated;
  const simulating = num(extra) > 0 || (num(oneOff) > 0 && !!oneOffMonth);

  return (
    <div className="space-y-6 pb-8">
      <BackButton onBack={onBack} label={t('debtDetail.back')} />

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-surface-sunk flex items-center justify-center text-muted-foreground shrink-0">
          <Icon className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-4xl tracking-tight font-display truncate">{debt.name}</h1>
          <p className="text-muted-foreground text-sm">
            {t(`debts.kind.${debt.kind}`)} · {t(`debts.paymentMode.${debt.paymentMode}`)}
            {debt.apr != null && ` · ${t('debts.aprShort', { apr: debt.apr })}`}
          </p>
        </div>
      </motion.div>

      {/* The one answer: what's left and when it ends. */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-8 space-y-6">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('debtDetail.leftToPay')}</p>
          <p className="text-5xl font-display tabular-nums">{fmt(debt.owed)}</p>
          {base?.converged && base.payoffMonth && base.months > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('debtDetail.endsOn', { date: monthLabel(base.payoffMonth, locale) })} · {t('debtDetail.monthsLeft', { count: base.months })}
            </p>
          )}
        </div>

        <StatusNote data={data} isOwner={isOwner} canEdit={!!fullDebt} onEdit={openEdit} />

        {(base || debt.paymentsTotal > 0) && (
          <PaidBar paid={debt.paymentsTotal} remaining={debt.owed} interest={base?.converged ? base.totalInterestPaid : null} fmt={fmt} />
        )}
      </motion.div>

      {/* Balance over time */}
      {(data.past.length > 1 || base) && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.2, ease: 'easeOut' }}
          className="bg-card border border-border rounded-3xl p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">{t('debtDetail.chartTitle')}</h2>
            <p className="text-xs text-muted-foreground">{t('debtDetail.chartHint')}</p>
          </div>
          <BalanceChart data={data} showSim={simulating && !!sim} fmt={fmt} locale={locale} />
          {data.assumesNoNewPurchases && base && (
            <p className="text-xs text-muted-foreground flex items-start gap-2"><Info className="w-4 h-4 shrink-0" />{t('debtDetail.noNewPurchases')}</p>
          )}
        </motion.div>
      )}

      {/* Simulator — only for looking */}
      {projection.status === 'ok' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.2, ease: 'easeOut' }}
          className="bg-card border border-border rounded-3xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <SlidersHorizontal className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold">{t('debtDetail.simTitle')}</h2>
              <p className="text-xs text-muted-foreground">{t('debtDetail.simHint')}</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            <label className="space-y-1.5 block" htmlFor="sim-extra">
              <span className="text-xs text-muted-foreground">{t('debtDetail.simExtra')}</span>
              <AmountInput id="sim-extra" value={extra} onChange={setExtra} currency={currency} />
            </label>
            <label className="space-y-1.5 block" htmlFor="sim-oneoff">
              <span className="text-xs text-muted-foreground">{t('debtDetail.simOneOff')}</span>
              <AmountInput id="sim-oneoff" value={oneOff} onChange={setOneOff} currency={currency} />
            </label>
            <label className="space-y-1.5 block" htmlFor="sim-oneoff-month">
              <span className="text-xs text-muted-foreground">{t('debtDetail.simOneOffMonth')}</span>
              <input id="sim-oneoff-month" type="month" min={nextMonthKey(data.startMonth)} value={oneOffMonth}
                onChange={e => setOneOffMonth(e.target.value)} className={`${inputClass} px-4`} />
            </label>
          </div>
          <div className="flex items-center gap-2 min-h-6" aria-live="polite">
            {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
            <SimResult base={base} sim={simulating ? sim : null} needsMonth={num(oneOff) > 0 && !oneOffMonth} fmt={fmt} locale={locale} />
          </div>
          <button onClick={onOpenPlan} className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm inline-flex items-center gap-2">
            <Route className="w-4 h-4" />{t('debtDetail.seePlan')}
          </button>
        </motion.div>
      )}

      {/* History */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('debtDetail.historyTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('debtDetail.historyHint')}</p>
        </div>
        {data.history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{t('debtDetail.historyEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.history.map(h => {
              const HIcon = h.type === 'payment' ? Banknote : h.type === 'adjustment' ? PencilLine : h.type === 'refund' ? RotateCcw : ShoppingBag;
              // Sign as it moves the debt: payments and refunds lower it.
              const lowers = h.type === 'payment' || h.type === 'refund' || (h.type === 'adjustment' && h.amount < 0);
              return (
                <li key={`${h.type}-${h.id}`} className="flex items-center gap-3 py-3">
                  <HIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{h.description || t(`debtDetail.historyType.${h.type}`)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(`debtDetail.historyType.${h.type}`)} · {new Date(`${h.date}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums shrink-0">{lowers ? '−' : '+'}{fmt(Math.abs(h.amount))}</p>
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>

      {/* Edit (to add what's missing) */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setEditing(false); }}>
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.22, ease: 'easeOut' }}
              className="bg-card border border-border rounded-3xl shadow-soft p-6 w-full max-w-md space-y-5 max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{t('debts.editTitle')}</h2>
                <button onClick={() => setEditing(false)} aria-label={t('debts.close')} className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <DebtFormFields form={form} setForm={setForm} />
              <button onClick={handleSave} disabled={saving}
                className="w-full h-12 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('debts.save')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ArrowLeft className="w-4 h-4" />{label}
    </button>
  );
}

/** Why there's no date, when there isn't one — never a made-up date. */
function StatusNote({ data, isOwner, canEdit, onEdit }: { data: DebtDetailData; isOwner: boolean; canEdit: boolean; onEdit: () => void }) {
  const { t } = useTranslation();
  const { status, missing, base } = data.projection;
  if (status === 'needs_data') {
    const fields = missing.map((m: MissingField) => t(`debtDetail.missing.${m}`)).join(t('debtDetail.missingJoin'));
    return (
      <div className="bg-sun-soft text-sun-ink rounded-2xl p-5 space-y-3">
        <p className="text-sm flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" />{t('debtDetail.needsData', { fields })}</p>
        {isOwner && canEdit
          ? <button onClick={onEdit} className="px-4 py-2 bg-card border border-border rounded-xl text-sm text-foreground hover:bg-muted transition-colors">{t('debtDetail.addData')}</button>
          : <p className="text-xs">{t('debtDetail.ownerAdds')}</p>}
      </div>
    );
  }
  const text = status === 'paid_in_full' ? t('debtDetail.paidInFull')
    : status === 'nothing_owed' ? t('debtDetail.nothingOwed')
    : base && !base.converged ? t('debtDetail.neverEnds')
    : null;
  if (!text) return null;
  return <p className="bg-surface-sunk rounded-2xl p-5 text-sm flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />{text}</p>;
}

/** Paid so far / still owed / interest still to pay, as one bar. */
function PaidBar({ paid, remaining, interest, fmt }: { paid: number; remaining: number; interest: number | null; fmt: (v: number) => string }) {
  const { t } = useTranslation();
  const total = paid + remaining + (interest ?? 0);
  const parts = [
    { key: 'paid', value: paid, color: 'var(--reed)', label: t('debtDetail.paid'), hint: t('debtDetail.paidHint') },
    { key: 'remaining', value: remaining, color: 'var(--pool)', label: t('debtDetail.remaining'), hint: null },
    ...(interest != null ? [{ key: 'interest', value: interest, color: 'var(--sun)', label: t('debtDetail.interestToPay'), hint: null }] : []),
  ];
  return (
    <div className="space-y-3">
      {total > 0 && (
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-surface-sunk" role="img" aria-label={parts.map(p => `${p.label}: ${fmt(p.value)}`).join(', ')}>
          {parts.filter(p => p.value > 0).map(p => <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        {parts.map(p => (
          <div key={p.key} className="space-y-0.5">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: p.color }} />{p.label}
            </p>
            <p className="text-2xl font-display tabular-nums">{fmt(p.value)}</p>
            {p.hint && <p className="text-xs text-muted-foreground">{p.hint}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SimResult({ base, sim, needsMonth, fmt, locale }: {
  base: DebtDetailData['projection']['base']; sim: DebtDetailData['projection']['simulated'];
  needsMonth: boolean; fmt: (v: number) => string; locale: string;
}) {
  const { t } = useTranslation();
  if (needsMonth) return <p className="text-sm text-muted-foreground">{t('debtDetail.simPickMonth')}</p>;
  if (!base || !sim) return <p className="text-sm text-muted-foreground">{t('debtDetail.simIdle')}</p>;
  if (!sim.converged || !sim.payoffMonth) return <p className="text-sm">{t('debtDetail.simNeverEnds')}</p>;
  if (!base.converged || !base.payoffMonth) return <p className="text-sm">{t('debtDetail.simEndsOn', { date: monthLabel(sim.payoffMonth, locale) })}</p>;
  const months = base.months - sim.months;
  const interest = base.totalInterestPaid - sim.totalInterestPaid;
  return (
    <p className="text-sm bg-reed-soft text-reed rounded-xl px-4 py-2">
      {t('debtDetail.simResult', {
        date: monthLabel(sim.payoffMonth, locale),
        before: monthLabel(base.payoffMonth, locale),
        months: t('debtDetail.monthsCount', { count: months }),
        interest: fmt(interest),
      })}
    </p>
  );
}

function BalanceChart({ data, showSim, fmt, locale }: { data: DebtDetailData; showSim: boolean; fmt: (v: number) => string; locale: string }) {
  const { t } = useTranslation();
  const rows = useMemo(() => {
    const byMonth = new Map<string, { month: string; real?: number; projected?: number; simulated?: number }>();
    const at = (month: string) => byMonth.get(month) ?? byMonth.set(month, { month }).get(month)!;
    for (const p of data.past) at(p.month).real = p.owed;
    for (const p of data.projection.base?.series ?? []) at(p.month).projected = p.owed;
    if (showSim) for (const p of data.projection.simulated?.series ?? []) at(p.month).simulated = p.owed;
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  }, [data, showSim]);

  return (
    <div className="h-64" role="img" aria-label={t('debtDetail.chartTitle')}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={m => monthLabel(m, locale, true)} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={v => fmt(v)} width={72} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(v: number, name: string) => [fmt(v), name]}
            labelFormatter={m => monthLabel(String(m), locale)}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="real" name={t('debtDetail.lineReal')} stroke="var(--pool)" strokeWidth={2} dot={false} connectNulls />
          <Line type="monotone" dataKey="projected" name={t('debtDetail.lineProjected')} stroke="var(--pool)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
          {showSim && <Line type="monotone" dataKey="simulated" name={t('debtDetail.lineSimulated')} stroke="var(--sun-ink)" strokeWidth={2} strokeDasharray="2 3" dot={false} connectNulls />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
