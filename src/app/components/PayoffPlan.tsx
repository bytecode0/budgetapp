import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Loader2, Info, Flame, TrendingDown, Route, ChevronRight, CheckCircle2 } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useMoney } from '../onboarding/useMoney';
import type { PayoffMethod } from '../hooks/useDebts';
import { usePayoffPlan, monthLabel, DEBT_CHART_COLORS, type PayoffPlanData } from '../hooks/useDebtProjection';

// The payoff plan (LPBETA-02): every visible active debt paid down month by
// month with the chosen method and extra, until the freedom date. Neither the
// method nor the extra is saved: it's for looking.

const MAX_SERIES = DEBT_CHART_COLORS.length; // beyond it, the rest fold into "others"
const OTHERS = '__others';

export function PayoffPlan({ onBack, onOpenDebt }: { onBack: () => void; onOpenDebt: (id: string) => void }) {
  const { t } = useTranslation();
  const { fmt, currency, locale } = useMoney();
  const [method, setMethod] = useState<PayoffMethod>('snowball');
  const [extra, setExtra] = useState('0');
  const { data, loading, failed } = usePayoffPlan({ method, extra: Math.max(0, parseFloat(extra) || 0) });

  return (
    <div className="space-y-6 pb-8">
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />{t('payoffPlan.back')}
      </button>

      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="space-y-2">
        <h1 className="text-4xl tracking-tight font-display">{t('payoffPlan.title')}</h1>
        <p className="text-muted-foreground">{t('payoffPlan.subtitle')}</p>
      </motion.div>

      {!data ? (
        failed && !loading
          ? <p className="text-sm text-muted-foreground">{t('payoffPlan.loadFailed')}</p>
          : <div className="bg-card border border-border rounded-3xl p-8 h-48 animate-pulse" />
      ) : data.included.length === 0 && data.excluded.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 bg-pool-soft text-pool rounded-3xl flex items-center justify-center mx-auto">
            <Route className="w-8 h-8" />
          </div>
          <p className="font-display text-lg">{t('payoffPlan.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">{t('payoffPlan.emptyDesc')}</p>
        </div>
      ) : (
        <>
          {/* Method and extra */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
            className="bg-card border border-border rounded-3xl p-6 space-y-5">
            <div role="radiogroup" aria-label={t('payoffPlan.methodLabel')} className="grid sm:grid-cols-2 gap-3">
              {([
                { m: 'snowball' as const, Icon: Flame },
                { m: 'avalanche' as const, Icon: TrendingDown },
              ]).map(({ m, Icon }) => (
                <button key={m} role="radio" aria-checked={method === m} onClick={() => setMethod(m)}
                  className={`text-left rounded-2xl border p-4 transition-colors ${method === m ? 'border-primary bg-pool-soft' : 'border-border hover:bg-muted'}`}>
                  <p className="font-semibold flex items-center gap-2"><Icon className="w-4 h-4 text-primary" />{t(`debts.method.${m}`)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t(`payoffPlan.methodHint.${m}`)}</p>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="plan-extra" className="text-sm font-medium shrink-0">{t('debts.extraPaymentLabel')}</label>
              <div className="relative flex-1 max-w-40">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
                <input id="plan-extra" type="number" inputMode="decimal" min={0} value={extra} onChange={e => setExtra(e.target.value)}
                  className="w-full h-11 pl-8 pr-4 border border-line-strong rounded-xl bg-background outline-none focus:border-primary text-sm tabular-nums" />
              </div>
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
          </motion.div>

          {data.plan && <PlanBody data={data} fmt={fmt} locale={locale} />}

          {data.excluded.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.2, ease: 'easeOut' }}
              className="bg-card border border-border rounded-3xl p-6 space-y-3">
              <h2 className="text-lg font-semibold">{t('payoffPlan.excludedTitle')}</h2>
              <ul className="space-y-2">
                {data.excluded.map(d => (
                  <li key={d.id}>
                    <button onClick={() => onOpenDebt(d.id)} className="w-full text-left flex items-center gap-3 rounded-2xl p-3 hover:bg-muted transition-colors">
                      <Info className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-sm">
                        {d.reason === 'paid_in_full'
                          ? t('payoffPlan.excludedFull', { name: d.name })
                          : t('payoffPlan.excludedMissing', { name: d.name, fields: d.missing.map(m => t(`debtDetail.missing.${m}`)).join(t('debtDetail.missingJoin')) })}
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </>
      )}
    </div>
  );
}

function PlanBody({ data, fmt, locale }: { data: PayoffPlanData; fmt: (v: number) => string; locale: string }) {
  const { t } = useTranslation();
  const plan = data.plan!;
  const freedom = plan.converged ? plan.payoffMonth : null;
  // Colour follows the debt (its place in the list), never the method's order.
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    data.included.forEach((d, i) => m.set(d.id, i < MAX_SERIES - 1 || data.included.length === MAX_SERIES ? DEBT_CHART_COLORS[i] : DEBT_CHART_COLORS[MAX_SERIES - 1]));
    return m;
  }, [data.included]);
  const hasCard = data.included.some(d => d.kind === 'credit_card');

  return (
    <>
      {/* The one answer: the freedom date. */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-8 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('payoffPlan.freedomLabel')}</p>
        {freedom ? (
          <>
            <p className="text-5xl font-display first-letter:uppercase">{monthLabel(freedom, locale)}</p>
            <p className="text-sm text-muted-foreground">
              {t('debtDetail.monthsLeft', { count: plan.months })} · {t('payoffPlan.interestTotal', { amount: fmt(plan.totalInterestPaid) })}
            </p>
          </>
        ) : (
          <p className="text-sm bg-surface-sunk rounded-2xl p-5 flex items-start gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />{t('payoffPlan.neverEnds')}</p>
        )}
        <Comparison data={data} fmt={fmt} />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('payoffPlan.chartTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('payoffPlan.chartHint')}</p>
        </div>
        <PlanChart data={data} colorOf={colorOf} fmt={fmt} locale={locale} />
        {hasCard && <p className="text-xs text-muted-foreground flex items-start gap-2"><Info className="w-4 h-4 shrink-0" />{t('debtDetail.noNewPurchases')}</p>}
      </motion.div>

      {/* Order (also the chart's table view) */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-6 space-y-3">
        <h2 className="text-lg font-semibold">{t('payoffPlan.orderTitle')}</h2>
        <ol className="divide-y divide-border">
          {orderedDebts(data).map((d, i) => (
            <li key={d.id} className="flex items-center gap-3 py-3">
              <span className="text-sm text-muted-foreground tabular-nums w-5 shrink-0">{i + 1}.</span>
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: colorOf.get(d.id) }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{fmt(d.owed)} · {t('payoffPlan.frees', { amount: fmt(d.minimumPayment) })}</p>
              </div>
              <p className="text-sm text-right shrink-0">
                {d.payoffMonth
                  ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-reed" />{monthLabel(d.payoffMonth, locale)}</span>
                  : <span className="text-muted-foreground">{t('payoffPlan.notClosed')}</span>}
              </p>
            </li>
          ))}
        </ol>
      </motion.div>
    </>
  );
}

/** Included debts in the method's payoff order; any that never close last. */
function orderedDebts(data: PayoffPlanData) {
  const order = data.plan?.payoffOrder ?? [];
  const at = new Map(order.map((p, i) => [p.id, i]));
  const monthOf = new Map(order.map(p => [p.id, p.payoffMonth]));
  return [...data.included]
    .sort((a, b) => (at.get(a.id) ?? Infinity) - (at.get(b.id) ?? Infinity))
    .map(d => ({ ...d, payoffMonth: monthOf.get(d.id) ?? null }));
}

/** "Con avalancha terminas N meses antes y ahorras X", in one line. */
function Comparison({ data, fmt }: { data: PayoffPlanData; fmt: (v: number) => string }) {
  const { t } = useTranslation();
  const a = data.plan;
  const b = data.other;
  if (!a || !b || !a.converged || !b.converged) return null;
  // The better one: less interest, then fewer months.
  const [best, worst] = a.totalInterestPaid < b.totalInterestPaid || (a.totalInterestPaid === b.totalInterestPaid && a.months <= b.months)
    ? [{ ...a, method: data.method }, b] : [b, { ...a, method: data.method }];
  const months = worst.months - best.months;
  const saved = worst.totalInterestPaid - best.totalInterestPaid;
  const method = t(`debts.method.${best.method}`);
  const text = months > 0 && saved > 0 ? t('payoffPlan.compareBoth', { method, months: t('debtDetail.monthsCount', { count: months }), amount: fmt(saved) })
    : saved > 0 ? t('payoffPlan.compareInterest', { method, amount: fmt(saved) })
    : months > 0 ? t('payoffPlan.compareMonths', { method, months: t('debtDetail.monthsCount', { count: months }) })
    : t('payoffPlan.compareSame');
  return <p className="inline-flex items-center gap-2 bg-pool-soft text-pool rounded-full px-4 py-2 text-sm font-medium">{text}</p>;
}

function PlanChart({ data, colorOf, fmt, locale }: { data: PayoffPlanData; colorOf: Map<string, string>; fmt: (v: number) => string; locale: string }) {
  const { t } = useTranslation();
  const plan = data.plan!;
  const minimums = data.minimumsOnly;
  const fold = data.included.length > MAX_SERIES;
  const seriesKeys = fold
    ? [...data.included.slice(0, MAX_SERIES - 1).map(d => d.id), OTHERS]
    : data.included.map(d => d.id);
  const nameOf = new Map<string, string>([...data.included.map(d => [d.id, d.name] as const), [OTHERS, t('payoffPlan.others')]]);
  const colorKey = (k: string) => (k === OTHERS ? DEBT_CHART_COLORS[MAX_SERIES - 1] : colorOf.get(k)!);

  // Long enough to see the plan reach zero and the minimums line clearly
  // above it; a minimums-only line that runs for decades is cut (and said).
  const horizon = Math.max(plan.series.length, Math.min(minimums?.series.length ?? 0, plan.series.length * 2 + 12));
  const cut = (minimums?.series.length ?? 0) > horizon;

  const rows = useMemo(() => {
    const out: Record<string, number | string>[] = [];
    for (let i = 0; i < horizon; i++) {
      const p = plan.series[i];
      const m = minimums?.series[i];
      const month = p?.month ?? m?.month;
      if (!month) break;
      const row: Record<string, number | string> = { month };
      for (const k of seriesKeys) row[k] = 0;
      for (const d of p?.debts ?? []) {
        const k = seriesKeys.includes(d.id) ? d.id : OTHERS;
        row[k] = (row[k] as number) + d.owed;
      }
      if (m) row.minimums = m.owed;
      out.push(row);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, horizon]);

  const freedom = plan.converged ? plan.payoffMonth : null;
  return (
    <div className="space-y-2">
      <div className="h-72" role="img" aria-label={t('payoffPlan.chartTitle')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="month" tickFormatter={m => monthLabel(m, locale, true)} minTickGap={24} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={v => fmt(v)} width={72} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
            <Tooltip
              formatter={(v: number, key: string) => [fmt(v), key === 'minimums' ? t('payoffPlan.minimumsOnly') : nameOf.get(key) ?? key]}
              labelFormatter={m => monthLabel(String(m), locale)}
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, color: 'var(--foreground)' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(key: string) => (key === 'minimums' ? t('payoffPlan.minimumsOnly') : nameOf.get(key) ?? key)} />
            {/* A 2px surface stroke separates the stacked debts (identity never by colour alone: legend and list too). */}
            {seriesKeys.map(k => (
              <Area key={k} type="monotone" dataKey={k} stackId="debts" stroke="var(--card)" strokeWidth={2} fill={colorKey(k)} fillOpacity={0.85} isAnimationActive={false} />
            ))}
            {minimums && <Line type="monotone" dataKey="minimums" stroke="var(--line-strong)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />}
            {plan.payoffOrder.slice(0, -1).map(p => (
              <ReferenceLine key={p.id} x={p.payoffMonth} stroke="var(--border)" strokeDasharray="2 3" />
            ))}
            {freedom && (
              <ReferenceLine x={freedom} stroke="var(--reed)" strokeWidth={2}
                label={{ value: t('payoffPlan.freedomMark'), position: 'insideTopRight', fill: 'var(--reed)', fontSize: 11 }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {cut && minimums && (
        <p className="text-xs text-muted-foreground">
          {minimums.converged && minimums.payoffMonth
            ? t('payoffPlan.minimumsCut', { date: monthLabel(minimums.payoffMonth, locale) })
            : t('payoffPlan.minimumsNever')}
        </p>
      )}
    </div>
  );
}
