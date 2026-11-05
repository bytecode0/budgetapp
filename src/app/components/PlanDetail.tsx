import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Calendar, TrendingUp, DollarSign, Target,
  Pencil, Trash2, CheckCircle2, Loader2, X, Check,
  PlusCircle, ChevronDown, ChevronUp, PiggyBank,
  AlertTriangle, RefreshCw,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { differenceInDays, format } from 'date-fns';
import { es as esLocale, enGB } from 'date-fns/locale';
import { toast } from 'sonner';
import { usePlans, getPlanStatus } from '../hooks/usePlans';
import { useTranslation } from 'react-i18next';
import { monthLabel, useMonth } from '../context/MonthContext';
import { currentPeriodKey } from '../lib/period';
import { useLanguage } from '../context/LanguageContext';
import { useMoney } from '../onboarding/useMoney';
import { compoundBalance, PROJECTION_RATE_PCTS, PROJECTION_RATES } from '../../../shared/projection';

const COLOR_OPTIONS = [
  '#1E3A8A','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#3B82F6','#EC4899','#06B6D4','#84CC16','#F97316',
];

// ── Projection math ──────────────────────────────────────────────────────────

const HORIZON_OPTIONS = [
  { key: 'goal', labelKey: 'planDetail.untilGoal' },
  { key: 60,     labelKey: 'planDetail.years5'    },
  { key: 120,    labelKey: 'planDetail.years10'   },
  { key: 180,    labelKey: 'planDetail.years15'   },
  { key: 240,    labelKey: 'planDetail.years20'   },
  { key: 360,    labelKey: 'planDetail.years30'   },
] as const;

type HorizonKey = typeof HORIZON_OPTIONS[number]['key'];

interface ProjectionPoint {
  label: string;
  month: number;
  linear?: number;
  pessimistic?: number;
  base?: number;
  optimistic?: number;
}

function monthsToGoal(
  current: number,
  monthly: number,
  target: number,
  annualRate: number,
  maxMonths = 480,
): number {
  for (let m = 0; m <= maxMonths; m++) {
    if (compoundBalance(current, monthly, m, annualRate) >= target) return m;
  }
  return maxMonths;
}

function buildProjectionData(
  current: number,
  monthly: number,
  target: number,
  isCompound: boolean,
  horizon: HorizonKey,
  rates: [number, number, number],
  axis: { now: string; year: (n: number) => string; month: (n: number) => string },
): ProjectionPoint[] {
  if (monthly <= 0 && current >= target) return [];

  const MAX_MONTHS = 480;
  const [r0, r1, r2] = rates;

  let endMonth: number;
  if (horizon === 'goal') {
    const linearM  = monthsToGoal(current, monthly, target, 0, MAX_MONTHS);
    const pessimM  = isCompound ? monthsToGoal(current, monthly, target, r0, MAX_MONTHS) : linearM;
    const baseM    = isCompound ? monthsToGoal(current, monthly, target, r1, MAX_MONTHS) : linearM;
    const optimM   = isCompound ? monthsToGoal(current, monthly, target, r2, MAX_MONTHS) : linearM;
    endMonth = Math.min(Math.max(linearM, pessimM, baseM, optimM), MAX_MONTHS);
  } else {
    endMonth = horizon as number;
  }

  const step = endMonth <= 24 ? 1 : endMonth <= 120 ? 3 : 12;

  const points: ProjectionPoint[] = [];
  for (let m = 0; m <= endMonth; m += step) {
    const label = m === 0 ? axis.now
      : m % 12 === 0 ? axis.year(m / 12)
      : axis.month(m);
    const pt: ProjectionPoint = { label, month: m };
    if (isCompound) {
      pt.pessimistic = compoundBalance(current, monthly, m, r0);
      pt.base        = compoundBalance(current, monthly, m, r1);
      pt.optimistic  = compoundBalance(current, monthly, m, r2);
    } else {
      pt.linear = current + monthly * m;
    }
    points.push(pt);
  }
  if (endMonth % step !== 0) {
    const m = endMonth;
    const label = m % 12 === 0 ? `Y${m / 12}` : `M${m}`;
    const pt: ProjectionPoint = { label, month: m };
    if (isCompound) {
      pt.pessimistic = compoundBalance(current, monthly, m, r0);
      pt.base        = compoundBalance(current, monthly, m, r1);
      pt.optimistic  = compoundBalance(current, monthly, m, r2);
    } else {
      pt.linear = current + monthly * m;
    }
    points.push(pt);
  }
  return points;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function ProjectionTooltip({ active, payload, label, target, t, fmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-lg text-sm space-y-1.5 min-w-[180px]">
      <p className="font-medium text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => {
        const overGoal = p.value > target;
        const gain     = p.value - target;
        return (
          <div key={p.dataKey} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              <span className="text-muted-foreground text-xs">{p.name}:</span>
              <span className="font-medium ml-auto">{fmt(Math.round(p.value))}</span>
            </div>
            {overGoal && (
              <p className="text-xs text-secondary pl-4">{t('planDetail.aboveGoalAmount', { amount: fmt(Math.round(gain)) })}</p>
            )}
            {!overGoal && p.value >= target * 0.999 && (
              <p className="text-xs text-secondary pl-4">{t('planDetail.goalReachedTick')}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function PlanDetail({ planId, onBack }: { planId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { fmt, currency } = useMoney();
  const { cycleStartDay } = useMonth();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const dateLocale = language === 'es' ? esLocale : enGB;
  const { plans, fetchPlans, updatePlan, deletePlan, contributeToPlan } = usePlans();
  const plan = plans.find(p => p.id === planId);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', goalClass: 'savings', targetAmount: '', currentAmount: '',
    monthlyContribution: '', deadline: '', color: '', icon: '',
  });

  const [showContribute, setShowContribute] = useState(false);
  const [contribAmount, setContribAmount] = useState('');
  const [contributing, setContributing] = useState(false);

  const [showProjection, setShowProjection] = useState(true);
  const [horizon, setHorizon] = useState<HorizonKey>('goal');
  const [simMonthly, setSimMonthly] = useState<number | null>(null);

  const [milestoneEdit, setMilestoneEdit] = useState<number[] | null>(null);
  const [milestoneInput, setMilestoneInput] = useState('');
  const [savingMilestones, setSavingMilestones] = useState(false);

  // Monthly contribution tracking
  // depositedAmount: the month's contribution, max(deposit, booked on the plan's line);
  // remainingAmount: what's left to reach the expected amount (GET /api/plans/monthly-status).
  type MonthlyContribStatus = { status: 'contributed' | 'missed' | 'pending'; expectedAmount: number; depositedAmount: number; remainingAmount: number } | null;
  const [monthlyStatus, setMonthlyStatus] = useState<MonthlyContribStatus>(null);
  const [showDepositPanel, setShowDepositPanel] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositing, setDepositing] = useState(false);

  // Allocation sync
  const [syncAllocationId, setSyncAllocationId] = useState<string | null>(null);
  const [syncingAllocation, setSyncingAllocation] = useState(false);

  // Recovery flow
  const [adjustingQuota, setAdjustingQuota] = useState(false);

  const openEdit = () => {
    if (!plan) return;
    setForm({
      title: plan.title,
      description: plan.description || '',
      goalClass: plan.goalClass || 'savings',
      targetAmount: String(plan.targetAmount),
      currentAmount: String(plan.currentAmount),
      monthlyContribution: String(plan.monthlyContribution),
      deadline: plan.deadline ? plan.deadline.split('T')[0] : '',
      color: plan.color,
      icon: plan.icon,
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!plan) return;
    setSaving(true);
    const result = await updatePlan(plan.id, {
      title: form.title,
      description: form.description,
      goalClass: form.goalClass,
      targetAmount: parseFloat(form.targetAmount) || 0,
      currentAmount: parseFloat(form.currentAmount) || 0,
      monthlyContribution: parseFloat(form.monthlyContribution) || 0,
      deadline: form.deadline || null,
      color: form.color,
      icon: form.icon,
    });
    setSaving(false);
    if ('error' in result && result.error) { toast.error(result.error as string); return; }
    toast.success(t('planDetail.planUpdated'));
    setEditing(false);
    if ('allocationOutOfSync' in result && result.allocationOutOfSync && result.linkedAllocationId) {
      setSyncAllocationId(result.linkedAllocationId as string);
    }
  };

  const handleDelete = async () => {
    if (!plan) return;
    setDeleting(true);
    const result = await deletePlan(plan.id);
    setDeleting(false);
    if ('error' in result && result.error) toast.error(result.error as string);
    else { toast.success(t('planDetail.planDeleted')); onBack(); }
  };

  const handleContribute = async () => {
    if (!plan) return;
    const amount = parseFloat(contribAmount.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) { toast.error(t('planDetail.invalidAmount')); return; }
    setContributing(true);
    const result = await contributeToPlan(plan.id, amount);
    setContributing(false);
    if ('error' in result && result.error) {
      toast.error(result.error as string);
    } else {
      toast.success(t('planDetail.contributionAdded', { amount: fmt(amount), title: plan.title }));
      setContribAmount('');
      setShowContribute(false);
    }
  };

  useEffect(() => {
    if (plan) setSimMonthly(prev => prev === null ? plan.monthlyContribution : prev);
  }, [plan?.monthlyContribution]);

  const effectiveMonthly = simMonthly ?? plan?.monthlyContribution ?? 0;
  const planType = plan?.goalClass || 'savings';
  const isInvestmentDerived = planType === 'investment' || planType === 'wealth';

  const parsedMilestones: number[] = (() => {
    if (!isInvestmentDerived) return [];
    try { return (JSON.parse(plan?.milestones || '[]') as number[]).sort((a, b) => a - b); }
    catch { return []; }
  })();
  const activeMilestones = milestoneEdit ?? parsedMilestones;

  const handleSaveMilestones = async () => {
    if (!plan || milestoneEdit === null) return;
    setSavingMilestones(true);
    const result = await updatePlan(plan.id, { milestones: JSON.stringify(milestoneEdit) });
    setSavingMilestones(false);
    if ('error' in result && result.error) toast.error(result.error as string);
    else { toast.success(t('planDetail.milestonesSaved')); setMilestoneEdit(null); setMilestoneInput(''); }
  };

  // Fetch monthly contribution status (only if plan has a linked allocation)
  const fetchMonthlyStatus = async (pid: string) => {
    const month = currentPeriodKey(cycleStartDay);
    const res = await fetch(`/api/plans/monthly-status?month=${month}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const entry = data.status.find((s: any) => s.planId === pid);
    setMonthlyStatus(entry ? { status: entry.status, expectedAmount: entry.expectedAmount, depositedAmount: entry.depositedAmount, remainingAmount: entry.remainingAmount ?? entry.expectedAmount } : null);
  };

  useEffect(() => { if (planId) fetchMonthlyStatus(planId); }, [planId]);

  const handleMonthlyDeposit = async () => {
    if (!plan) return;
    const added = parseFloat(depositAmount) || plan.monthlyContribution;
    if (!added || added <= 0) return;
    // The deposit is the month's total: what's already contributed (booked
    // from the bank or registered) plus what's added now, so nothing counts twice.
    const amount = (monthlyStatus?.depositedAmount ?? 0) + added;
    setDepositing(true);
    const month = currentPeriodKey(cycleStartDay);
    const res = await fetch('/api/plan-deposits/confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, deposits: [{ planId: plan.id, amount }] }),
    });
    setDepositing(false);
    if (res.ok) {
      await fetchPlans();
      await fetchMonthlyStatus(plan.id);
      setShowDepositPanel(false);
      setDepositAmount('');
      toast.success(t('planDetail.contribRegistered'));
    } else {
      toast.error(t('planDetail.contributionFailed'));
    }
  };

  const handleSyncAllocation = async () => {
    if (!plan || !syncAllocationId) return;
    setSyncingAllocation(true);
    const res = await fetch(`/api/allocations/${syncAllocationId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allocatedAmount: plan.monthlyContribution }),
    });
    setSyncingAllocation(false);
    if (res.ok) {
      setSyncAllocationId(null);
      toast.success(t('planDetail.allocationSynced', { amount: fmt(plan.monthlyContribution) }));
    } else {
      toast.error(t('planDetail.syncFailed'));
    }
  };

  const handleAdjustQuota = async (newMonthly: number) => {
    if (!plan) return;
    setAdjustingQuota(true);
    const result = await updatePlan(plan.id, { monthlyContribution: newMonthly });
    setAdjustingQuota(false);
    if ('error' in result && result.error) { toast.error(result.error as string); return; }
    toast.success(t('planDetail.quotaUpdated', { amount: fmt(newMonthly) }));
    if ('allocationOutOfSync' in result && result.allocationOutOfSync && result.linkedAllocationId) {
      setSyncAllocationId(result.linkedAllocationId);
    }
  };

  const projectionData = useMemo(() => {
    if (!plan || effectiveMonthly <= 0) return [];
    return buildProjectionData(
      plan.currentAmount,
      effectiveMonthly,
      plan.targetAmount,
      isInvestmentDerived,
      horizon,
      PROJECTION_RATES,
      { now: t('planDetail.axisNow'), year: n => t('planDetail.axisYear', { n }), month: n => t('planDetail.axisMonth', { n }) },
    );
  }, [plan?.currentAmount, effectiveMonthly, plan?.targetAmount, plan?.goalClass, horizon, t]);

  if (!plan) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        {t('planDetail.notFound')}
      </div>
    );
  }

  const progress         = plan.targetAmount > 0 ? (plan.currentAmount / plan.targetAmount) * 100 : 0;
  const remaining        = Math.max(0, plan.targetAmount - plan.currentAmount);
  const status           = getPlanStatus(plan);
  const daysLeft         = plan.deadline ? differenceInDays(new Date(plan.deadline), new Date()) : null;
  const monthsLeft       = daysLeft !== null ? Math.max(0, Math.ceil(daysLeft / 30)) : null;
  const isInvestment     = isInvestmentDerived;

  const scenarioLabel = (k: keyof typeof PROJECTION_RATE_PCTS) =>
    t(`planDetail.scenario.${k}`, { rate: PROJECTION_RATE_PCTS[k].toLocaleString(locale) });
  // One neutral hue for the three scenarios: they are examples, not good or
  // bad outcomes (no red/amber/green grading, LPBETA-06).
  const scenarioConfig = [
    { pill: scenarioLabel('low'), rate: PROJECTION_RATES[0], stroke: 'var(--pool)', opacity: 0.45, dash: '4 4', dotStyle: { backgroundColor: 'var(--pool)', opacity: 0.45 }, pillCls: 'bg-muted text-foreground border-border', textColor: 'text-foreground', bg: 'bg-muted/50' },
    { pill: scenarioLabel('medium'), rate: PROJECTION_RATES[1], stroke: 'var(--pool)', opacity: 1, dash: undefined, dotStyle: { backgroundColor: 'var(--pool)', opacity: 1 }, pillCls: 'bg-muted text-foreground border-border', textColor: 'text-foreground', bg: 'bg-muted/50' },
    { pill: scenarioLabel('high'), rate: PROJECTION_RATES[2], stroke: 'var(--pool)', opacity: 0.7, dash: '1 3', dotStyle: { backgroundColor: 'var(--pool)', opacity: 0.7 }, pillCls: 'bg-muted text-foreground border-border', textColor: 'text-foreground', bg: 'bg-muted/50' },
  ];

  const projectedCompletion = (() => {
    if (plan.monthlyContribution <= 0 || remaining <= 0) return null;
    const monthsNeeded = Math.ceil(remaining / plan.monthlyContribution);
    const d = new Date();
    d.setMonth(d.getMonth() + monthsNeeded);
    return d;
  })();

  const savingsMilestones = [25, 50, 75, 100].map(pct => ({
    pct,
    amount: plan.targetAmount * pct / 100,
    reached: progress >= pct,
  }));

  return (
    <div className="space-y-6 pb-8">
      {/* ── Header ── */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="w-10 h-10 bg-card border border-border rounded-lg flex items-center justify-center hover:bg-muted transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-4xl tracking-tight">{plan.title}</h1>
            {plan.description && <p className="text-muted-foreground">{plan.description}</p>}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={openEdit}
            className="px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors flex items-center gap-2 text-sm"
          >
            <Pencil className="w-4 h-4" /> {t('planDetail.edit')}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 border border-destructive/20 text-destructive rounded-lg hover:bg-destructive/5 transition-colors flex items-center gap-2 text-sm"
            >
              <Trash2 className="w-4 h-4" /> {t('planDetail.delete')}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">{t('planDetail.areYouSure')}</span>
              <button
                onClick={handleDelete} disabled={deleting}
                className="px-3 py-2 bg-destructive text-destructive-foreground rounded-lg text-sm hover:bg-destructive/90 transition-colors flex items-center gap-1"
              >
                {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {t('planDetail.yes')}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Edit Panel ── */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-card border border-line-strong rounded-3xl p-6 space-y-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg">{t('planDetail.editPlan')}</h3>
              <button onClick={() => setEditing(false)} className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.name')}</label>
                <input
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.descriptionOptional')}</label>
                <input
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.planType')}</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'safety',     labelKey: 'planDetail.typeSafety',      icon: '🛡️', active: 'bg-primary text-primary-foreground border-primary' },
                    { value: 'savings',    labelKey: 'planDetail.typeSavings',     icon: '🎯', active: 'bg-primary text-primary-foreground border-primary' },
                    { value: 'investment', labelKey: 'planDetail.typeInvestment',  icon: '📈', active: 'bg-secondary text-primary-foreground border-secondary' },
                    { value: 'wealth',     labelKey: 'planDetail.typeWealth',      icon: '🚀', active: 'bg-primary text-primary-foreground border-primary' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, goalClass: opt.value }))}
                      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        form.goalClass === opt.value ? opt.active : 'border-border hover:bg-muted'
                      }`}
                    >
                      <span>{opt.icon}</span> {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">
                  {form.goalClass === 'investment' ? t('planDetail.milestoneOptional') : t('planDetail.targetAmount')}
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{currency}</span>
                  <input type="number" min="0"
                    className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
                    value={form.targetAmount}
                    onChange={e => setForm(f => ({ ...f, targetAmount: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.alreadySaved')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{currency}</span>
                  <input type="number" min="0"
                    className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
                    value={form.currentAmount}
                    onChange={e => setForm(f => ({ ...f, currentAmount: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.monthlyContribution')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{currency}</span>
                  <input type="number" min="0"
                    className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
                    value={form.monthlyContribution}
                    onChange={e => setForm(f => ({ ...f, monthlyContribution: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.targetDateOptional')}</label>
                <input type="date"
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                  value={form.deadline}
                  onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-muted-foreground mb-1.5 block">{t('planDetail.color')}</label>
                <div className="flex gap-2 flex-wrap">
                  {COLOR_OPTIONS.map(c => (
                    <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                      className={`w-8 h-8 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-primary scale-110' : 'hover:scale-105'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setEditing(false)} className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm">
                {t('planDetail.cancel')}
              </button>
              <button
                onClick={handleSave} disabled={saving || !form.title}
                className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('planDetail.saving')}</> : <><CheckCircle2 className="w-4 h-4" /> {t('planDetail.saveChanges')}</>}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Allocation sync banner ── */}
      <AnimatePresence>
        {syncAllocationId && plan && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 bg-sun-soft text-sun-ink rounded-2xl px-4 py-3"
          >
            <RefreshCw className="w-4 h-4 shrink-0" />
            <p className="text-sm flex-1">
              {t('planDetail.syncAllocationBanner', { current: fmt(plan.monthlyContribution) })}
            </p>
            <button
              onClick={handleSyncAllocation}
              disabled={syncingAllocation}
              className="px-3 py-1.5 bg-card text-foreground border border-line-strong hover:bg-muted rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              {syncingAllocation ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {t('planDetail.syncAllocationBtn')}
            </button>
            <button onClick={() => setSyncAllocationId(null)} className="w-9 h-9 flex items-center justify-center hover:bg-card rounded-lg shrink-0">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hero Card (LPBETA-27): calm card, the plan's colour as an accent ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
        className="bg-card border border-border rounded-3xl p-6 md:p-8 space-y-6"
      >
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="w-16 h-16 rounded-3xl flex items-center justify-center text-4xl" style={{ backgroundColor: plan.color + '26' }}>{plan.icon}</div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1.5 ${
              status === 'completed' || status === 'behind' ? 'bg-sun-soft text-sun-ink' : 'bg-reed-soft text-reed'
            }`}>
              {status === 'behind' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {status === 'completed' && t('planDetail.statusCompleted')}
              {status === 'on-track'  && t('planDetail.statusOnTrack')}
              {status === 'ahead'     && t('planDetail.statusAhead')}
              {status === 'behind'    && t('planDetail.statusBehind')}
            </span>
            {plan.currentAmount < plan.targetAmount && (
              <button
                onClick={() => setShowContribute(v => !v)}
                className="h-11 px-5 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl text-sm font-medium transition-colors flex items-center gap-2"
              >
                <PlusCircle className="w-4 h-4" />
                {t('planDetail.addContribution')}
              </button>
            )}
          </div>
        </div>

        {/* Contribution inline panel */}
        <AnimatePresence>
          {showContribute && (
            <motion.div
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div className="bg-surface-sunk rounded-2xl p-5 space-y-3">
                <label htmlFor="plan-contribution" className="text-sm font-medium block">{t('planDetail.howMuchAdding')}</label>
                <div className="flex gap-3">
                  <div className="flex items-center gap-2 bg-card border border-line-strong rounded-xl px-4 h-12 flex-1 focus-within:border-primary">
                    <span className="text-muted-foreground text-sm">{currency}</span>
                    <input
                      id="plan-contribution"
                      type="number" min="0" step="50" inputMode="decimal"
                      placeholder={String(plan.monthlyContribution || 100)}
                      className="flex-1 min-w-0 bg-transparent outline-none text-lg font-display tabular-nums"
                      value={contribAmount}
                      onChange={e => setContribAmount(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleContribute(); if (e.key === 'Escape') setShowContribute(false); }}
                      autoFocus
                    />
                  </div>
                  <button
                    onClick={handleContribute} disabled={contributing}
                    className="h-12 px-5 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-60"
                  >
                    {contributing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    {t('planDetail.confirm')}
                  </button>
                  <button
                    onClick={() => setShowContribute(false)}
                    aria-label={t('planDetail.cancel')}
                    className="w-12 h-12 hover:bg-muted rounded-xl flex items-center justify-center transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {[50, 100, 200, 500].map(v => (
                    <button
                      key={v}
                      onClick={() => setContribAmount(String(v))}
                      className="h-9 px-3 bg-card border border-line-strong hover:bg-muted rounded-full text-xs font-medium transition-colors tabular-nums"
                    >
                      +{fmt(v)}
                    </button>
                  ))}
                  {plan.monthlyContribution > 0 && ![50, 100, 200, 500].includes(plan.monthlyContribution) && (
                    <button
                      onClick={() => setContribAmount(String(plan.monthlyContribution))}
                      className="h-9 px-3 bg-card border border-line-strong hover:bg-muted rounded-full text-xs font-medium transition-colors tabular-nums"
                    >
                      +{fmt(plan.monthlyContribution)} {t('planDetail.planned')}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('planDetail.currentProgress')}</p>
          <p className="text-5xl font-display tabular-nums">{fmt(plan.currentAmount)}</p>
          <p className="text-sm text-muted-foreground tabular-nums">{t('planDetail.of')} {fmt(plan.targetAmount)}</p>
        </div>

        <div className="space-y-2">
          <div className="h-3 bg-surface-sunk rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(Math.min(progress, 100))} aria-valuemin={0} aria-valuemax={100} aria-label={plan.title}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(progress, 100)}%` }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="h-full rounded-full"
              style={{ backgroundColor: plan.color }}
            />
          </div>
          <p className="text-sm text-muted-foreground">{t('planDetail.progressPct', { progress: progress.toFixed(1) })}</p>
        </div>

        <div className="grid grid-cols-2 gap-6 pt-6 border-t border-border">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('planDetail.remaining')}</p>
            <p className="text-2xl font-display tabular-nums">{fmt(remaining)}</p>
            <p className="text-sm text-muted-foreground">
              {monthsLeft !== null ? t('planDetail.monthsLeft', { count: monthsLeft }) : t('planDetail.noDeadline')}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('planDetail.monthlyContribution')}</p>
            <p className="text-2xl font-display tabular-nums">{fmt(plan.monthlyContribution)}</p>
            <p className="text-sm text-muted-foreground">{t('planDetail.perMonth')}</p>
          </div>
        </div>
      </motion.div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card border border-border rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">{t('planDetail.targetDate')}</p>
          </div>
          {plan.deadline ? (
            <>
              <p className="text-2xl font-display">{format(new Date(plan.deadline), 'MMM dd, yyyy')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {daysLeft! > 0
                  ? t('planDetail.daysAway', { days: daysLeft })
                  : t('planDetail.deadlinePassed')}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-display text-muted-foreground">{t('planDetail.noDeadline')}</p>
              <button onClick={openEdit} className="text-sm text-primary mt-1 hover:underline">{t('planDetail.setDate')}</button>
            </>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-card border border-border rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-secondary" />
            </div>
            <p className="text-sm text-muted-foreground">{t('planDetail.projectedCompletion')}</p>
          </div>
          {projectedCompletion ? (
            <>
              <p className="text-2xl font-display">{format(projectedCompletion, 'MMM yyyy')}</p>
              <p className={`text-sm mt-1 ${plan.deadline && projectedCompletion < new Date(plan.deadline) ? 'text-secondary' : 'text-muted-foreground'}`}>
                {plan.deadline && projectedCompletion < new Date(plan.deadline)
                  ? t('planDetail.aheadOfSchedule')
                  : t('planDetail.basedOnCurrentRate')}
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-display text-muted-foreground">—</p>
              <button onClick={openEdit} className="text-sm text-primary mt-1 hover:underline">{t('planDetail.setContribution')}</button>
            </>
          )}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-card border border-border rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-accent" />
            </div>
            <p className="text-sm text-muted-foreground">{t('planDetail.alreadySaved')}</p>
          </div>
          <p className="text-2xl font-display">{fmt(plan.currentAmount)}</p>
          <button
            onClick={() => setShowContribute(true)}
            className="text-sm text-primary mt-1 hover:underline flex items-center gap-1"
          >
            <PlusCircle className="w-3 h-3" /> {t('planDetail.addContributionBtn')}
          </button>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-card border border-border rounded-3xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">{t('planDetail.stillNeeded')}</p>
          </div>
          <p className="text-2xl font-display">{fmt(remaining)}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('planDetail.pctToGo', { pct: (100 - Math.min(progress, 100)).toFixed(0) })}</p>
        </motion.div>
      </div>

      {/* ── Monthly Contribution Status ── */}
      {monthlyStatus !== null && plan.currentAmount < plan.targetAmount && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
          <div className={`rounded-2xl border-2 p-5 transition-colors ${
            monthlyStatus.status === 'contributed'
              ? 'bg-reed-soft border-transparent'
              : monthlyStatus.status === 'missed'
              ? 'bg-sun-soft border-transparent'
              : 'bg-card border-border'
          }`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                {monthlyStatus.status === 'contributed' && <CheckCircle2 className="w-5 h-5 text-reed shrink-0" />}
                {monthlyStatus.status === 'missed'      && <AlertTriangle className="w-5 h-5 text-sun-ink shrink-0" />}
                {monthlyStatus.status === 'pending'     && <div className="w-5 h-5 rounded-full border-2 border-primary/40 shrink-0" />}
                <div>
                  <p className="font-medium text-sm">
                    {monthlyStatus.status === 'contributed' && t('planDetail.monthContributed', { amount: fmt(monthlyStatus.depositedAmount) })}
                    {monthlyStatus.status === 'missed'      && t('planDetail.monthMissed')}
                    {monthlyStatus.status === 'pending'     && t('planDetail.monthPending', { amount: fmt(monthlyStatus.remainingAmount) })}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">
                    {monthLabel(currentPeriodKey(cycleStartDay), locale)}
                  </p>
                </div>
              </div>
              {monthlyStatus.status !== 'contributed' && !showDepositPanel && (
                <button
                  onClick={() => { setDepositAmount(String(monthlyStatus.remainingAmount)); setShowDepositPanel(true); }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 transition-colors shrink-0"
                >
                  {t('planDetail.registerContrib')}
                </button>
              )}
            </div>

            <AnimatePresence>
              {showDepositPanel && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 pt-4 border-t border-border space-y-3">
                    <p className="text-sm font-medium">{t('planDetail.registerThisMonth')}</p>
                    <div className="flex gap-3">
                      <div className="flex items-center gap-2 flex-1 border border-border rounded-xl px-3 py-2 bg-background">
                        <span className="text-muted-foreground text-sm">{currency}</span>
                        <input
                          type="number" min="0" step="10"
                          className="flex-1 outline-none bg-transparent text-sm font-display"
                          value={depositAmount}
                          onChange={e => setDepositAmount(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleMonthlyDeposit(); if (e.key === 'Escape') setShowDepositPanel(false); }}
                          autoFocus
                        />
                      </div>
                      <button
                        onClick={handleMonthlyDeposit} disabled={depositing}
                        className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-50 shrink-0"
                      >
                        {depositing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {t('planDetail.confirm')}
                      </button>
                      <button onClick={() => setShowDepositPanel(false)} className="w-10 h-10 border border-border rounded-xl flex items-center justify-center hover:bg-muted transition-colors shrink-0">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {[monthlyStatus.expectedAmount, Math.round(monthlyStatus.expectedAmount * 1.5), Math.round(monthlyStatus.expectedAmount * 2)]
                        .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i)
                        .map(v => (
                          <button key={v} onClick={() => setDepositAmount(String(v))}
                            className="px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-lg text-xs transition-colors"
                          >
                            {fmt(v)}
                          </button>
                        ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}

      {/* ── Recovery Flow (when behind and has allocation) ── */}
      {status === 'behind' && plan.deadline && monthlyStatus !== null && plan.currentAmount < plan.targetAmount && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }}
          className="bg-sun-soft rounded-3xl p-5 space-y-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-sun-ink shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm text-sun-ink">{t('planDetail.recoveryTitle')}</p>
              <p className="text-xs text-foreground/80 mt-0.5">{t('planDetail.recoverySubtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option A: Catch up */}
            <div className="bg-card rounded-2xl p-4 border border-border">
              <p className="font-medium text-sm mb-1">{t('planDetail.optionCatchUp')}</p>
              <p className="text-xs text-muted-foreground mb-3">{t('planDetail.optionCatchUpDesc')}</p>
              <button
                onClick={() => {
                  const gap = Math.max(0, plan.targetAmount - plan.currentAmount);
                  const monthsLeft = Math.max(1, Math.ceil((new Date(plan.deadline!).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000)));
                  const catchUp = Math.ceil((gap / monthsLeft) - plan.monthlyContribution + plan.monthlyContribution);
                  setDepositAmount(String(plan.monthlyContribution));
                  setShowDepositPanel(true);
                }}
                className="w-full py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-xs font-medium transition-colors"
              >
                {t('planDetail.registerContrib')}
              </button>
            </div>

            {/* Option B: Adjust quota */}
            {(() => {
              const monthsLeft = Math.max(1, Math.ceil((new Date(plan.deadline!).getTime() - Date.now()) / (30 * 24 * 60 * 60 * 1000)));
              const remaining = Math.max(0, plan.targetAmount - plan.currentAmount);
              const newQuota = Math.ceil(remaining / monthsLeft);
              return newQuota > plan.monthlyContribution ? (
                <div className="bg-card rounded-2xl p-4 border border-border">
                  <p className="font-medium text-sm mb-1">{t('planDetail.optionAdjustQuota')}</p>
                  <p className="text-xs text-muted-foreground mb-1">{t('planDetail.optionAdjustQuotaDesc')}</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    {t('planDetail.newQuotaLabel')}: <strong>{fmt(newQuota)}{t('currency.perMonthSuffix')}</strong>
                  </p>
                  <button
                    onClick={() => handleAdjustQuota(newQuota)}
                    disabled={adjustingQuota}
                    className="w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {adjustingQuota ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {t('planDetail.adjustQuotaBtn', { amount: fmt(newQuota) })}
                  </button>
                </div>
              ) : null;
            })()}
          </div>
        </motion.div>
      )}

      {/* ── Projection Chart ── */}
      {(plan.monthlyContribution > 0 || (simMonthly ?? 0) > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="bg-card border border-border rounded-2xl overflow-hidden"
        >
          <button
            onClick={() => setShowProjection(v => !v)}
            className="w-full flex items-center justify-between p-6 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: plan.color + '20' }}>
                <TrendingUp className="w-5 h-5" style={{ color: plan.color }} />
              </div>
              <div className="text-left">
                <p className="font-display text-lg">
                  {isInvestment
                    ? (planType === 'wealth' ? t('planDetail.wealthProjection') : t('planDetail.investmentProjection'))
                    : t('planDetail.goalProjection')}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isInvestment
                    ? `${scenarioConfig.map(s => s.pill).join(' · ')} · ${t('planDetail.simulationShort')}`
                    : `${fmt(effectiveMonthly)}${t('currency.perMonthSuffix')} — ${plan.currentAmount < plan.targetAmount && projectedCompletion ? `${format(projectedCompletion, 'MMM yyyy')}` : t('planDetail.goalReached')}`}
                </p>
              </div>
            </div>
            {showProjection ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
          </button>

          <AnimatePresence>
            {showProjection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 space-y-5">

                  {/* Monthly contribution what-if slider */}
                  <div className="bg-muted/50 border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{t('planDetail.monthlyContribution')}</p>
                        <p className="text-xs text-muted-foreground">{t('planDetail.adjustScenarios')}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm text-muted-foreground">{currency}</span>
                        <input
                          type="number"
                          min="0"
                          step="50"
                          className="w-24 text-right text-sm font-display font-medium border border-border rounded-lg px-2 py-1.5 outline-none focus:border-primary bg-background"
                          value={effectiveMonthly}
                          onChange={e => setSimMonthly(Math.max(0, parseFloat(e.target.value) || 0))}
                        />
                        {simMonthly !== null && simMonthly !== plan.monthlyContribution && (
                          <button
                            onClick={() => setSimMonthly(plan.monthlyContribution)}
                            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors"
                            title={t('planDetail.resetToSaved')}
                          >
                            ↩
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={Math.max(plan.targetAmount / 12, effectiveMonthly * 2, 1000)}
                      step="50"
                      value={effectiveMonthly}
                      onChange={e => setSimMonthly(parseInt(e.target.value))}
                      className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, ${plan.color} 0%, ${plan.color} ${Math.min((effectiveMonthly / Math.max(plan.targetAmount / 12, effectiveMonthly * 2, 1000)) * 100, 100)}%, #E5E7EB ${Math.min((effectiveMonthly / Math.max(plan.targetAmount / 12, effectiveMonthly * 2, 1000)) * 100, 100)}%, #E5E7EB 100%)`
                      }}
                    />
                    {simMonthly !== null && simMonthly !== plan.monthlyContribution && (
                      <p className="text-xs text-sun-ink">
                        {t('planDetail.simulationNote', { amount: fmt(plan.monthlyContribution) })}
                        {' '}<button onClick={openEdit} className="underline hover:no-underline">{t('planDetail.saveChanges')} →</button>
                      </p>
                    )}
                  </div>

                  {/* Horizon selector */}
                  <div className="flex gap-1 bg-muted p-1 rounded-xl overflow-x-auto">
                    {HORIZON_OPTIONS.map(opt => (
                      <button
                        key={String(opt.key)}
                        onClick={() => setHorizon(opt.key)}
                        className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                          horizon === opt.key
                            ? 'bg-card shadow text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>

                  {/* Investment scenario pills */}
                  {isInvestment && (
                    <div className="flex gap-2 flex-wrap">
                      {scenarioConfig.map(s => (
                        <div key={s.pill} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${s.pillCls}`}>
                          <div className="w-2 h-2 rounded-full" style={s.dotStyle} />
                          {s.pill}
                        </div>
                      ))}
                    </div>
                  )}

                  {isInvestment && (
                    <p className="text-xs text-muted-foreground flex items-start gap-2">
                      <Info className="w-4 h-4 shrink-0 mt-px" /> {t('planDetail.simulationDisclaimer')}
                    </p>
                  )}

                  {/* Chart */}
                  {projectionData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={projectionData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }}
                          tickLine={false}
                          axisLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: 'currentColor', opacity: 0.5 }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={v => v >= 1000 ? `${currency}${(v / 1000).toFixed(0)}k` : `${currency}${v}`}
                          width={60}
                        />
                        <Tooltip content={<ProjectionTooltip target={plan.targetAmount} t={t} fmt={fmt} />} />

                        {isInvestment && parsedMilestones.filter(m => m !== plan.targetAmount && m > 0).map(amount => (
                          <ReferenceLine
                            key={amount}
                            y={amount}
                            stroke={plan.color}
                            strokeDasharray="2 5"
                            strokeOpacity={0.3}
                            label={{
                              value: amount >= 1000 ? `${currency}${(amount / 1000).toFixed(0)}k` : `${currency}${amount}`,
                              position: 'insideTopRight',
                              fontSize: 10,
                              fill: plan.color,
                              opacity: 0.5,
                            }}
                          />
                        ))}

                        <ReferenceLine
                          y={plan.targetAmount}
                          stroke={plan.color}
                          strokeDasharray="6 3"
                          strokeOpacity={0.6}
                          label={{
                            value: t('planDetail.goalAmount', { amount: fmt(plan.targetAmount) }),
                            position: 'insideTopRight',
                            fontSize: 11,
                            fill: plan.color,
                            opacity: 0.8,
                          }}
                        />

                        {horizon !== 'goal' && (() => {
                          const goalMonth = isInvestment
                            ? monthsToGoal(plan.currentAmount, effectiveMonthly, plan.targetAmount, PROJECTION_RATES[1], horizon as number)
                            : monthsToGoal(plan.currentAmount, effectiveMonthly, plan.targetAmount, 0, horizon as number);
                          if (goalMonth >= (horizon as number)) return null;
                          const step = (horizon as number) <= 24 ? 1 : (horizon as number) <= 120 ? 3 : 12;
                          const snapMonth = Math.round(goalMonth / step) * step;
                          const pt = projectionData.find(p => p.month === snapMonth);
                          if (!pt) return null;
                          return (
                            <ReferenceLine
                              x={pt.label}
                              stroke={plan.color}
                              strokeDasharray="4 4"
                              strokeOpacity={0.4}
                              label={{
                                value: t('planDetail.goalReached'),
                                position: 'insideTopLeft',
                                fontSize: 10,
                                fill: plan.color,
                                opacity: 0.6,
                              }}
                            />
                          );
                        })()}

                        {isInvestment ? (
                          <>
                            <Line type="monotone" dataKey="pessimistic" name={scenarioConfig[0].pill} stroke={scenarioConfig[0].stroke} strokeOpacity={scenarioConfig[0].opacity} strokeDasharray={scenarioConfig[0].dash} strokeWidth={2}   dot={false} activeDot={{ r: 4, fill: scenarioConfig[0].stroke }} />
                            <Line type="monotone" dataKey="base"        name={scenarioConfig[1].pill} stroke={scenarioConfig[1].stroke} strokeOpacity={scenarioConfig[1].opacity} strokeDasharray={scenarioConfig[1].dash} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: scenarioConfig[1].stroke }} />
                            <Line type="monotone" dataKey="optimistic"  name={scenarioConfig[2].pill} stroke={scenarioConfig[2].stroke} strokeOpacity={scenarioConfig[2].opacity} strokeDasharray={scenarioConfig[2].dash} strokeWidth={2}   dot={false} activeDot={{ r: 4, fill: scenarioConfig[2].stroke }} />
                          </>
                        ) : (
                          <Line type="monotone" dataKey="linear" name="Projection" stroke={plan.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: plan.color }} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                      {t('planDetail.goalAlreadyReached')}
                    </div>
                  )}

                  {/* Summary cards */}
                  {isInvestment ? (
                    <div className="grid grid-cols-3 gap-3">
                      {scenarioConfig.map(({ pill: name, rate, textColor, bg }) => {
                        const horizonM = horizon === 'goal' ? 480 : (horizon as number);
                        const goalM    = monthsToGoal(plan.currentAmount, effectiveMonthly, plan.targetAmount, rate, 480);
                        const balance  = compoundBalance(plan.currentAmount, effectiveMonthly, horizonM, rate);
                        const goalDate = new Date(); goalDate.setMonth(goalDate.getMonth() + goalM);

                        return (
                          <div key={name} className={`${bg} rounded-xl p-3 space-y-1.5`}>
                            <p className="text-xs text-muted-foreground font-medium">{name}</p>
                            {horizon === 'goal' ? (
                              <>
                                <p className={`font-display text-sm ${textColor}`}>{format(goalDate, 'MMM yyyy')}</p>
                                <p className="text-xs text-muted-foreground">
                                  {goalM < 12
                                    ? t('planDetail.months', { count: goalM })
                                    : `${(goalM / 12).toFixed(1)} ${t('planDetail.years', { count: (goalM / 12).toFixed(1) })}`}
                                </p>
                              </>
                            ) : (
                              <>
                                <p className={`font-display text-sm ${textColor}`}>{fmt(Math.round(balance))}</p>
                                <p className="text-xs text-muted-foreground">
                                  {goalM <= horizonM
                                    ? t('planDetail.goalReachedIn', { time: goalM < 12 ? `${goalM}mo` : `${(goalM / 12).toFixed(1)}y` })
                                    : t('planDetail.pctOfGoal', { pct: ((balance / plan.targetAmount) * 100).toFixed(0) })}
                                </p>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    (() => {
                      const horizonM = horizon === 'goal' ? monthsToGoal(plan.currentAmount, effectiveMonthly, plan.targetAmount, 0, 480) : (horizon as number);
                      const balance  = compoundBalance(plan.currentAmount, effectiveMonthly, horizonM, 0);
                      const goalM    = monthsToGoal(plan.currentAmount, effectiveMonthly, plan.targetAmount, 0, 480);
                      const goalDate = new Date(); goalDate.setMonth(goalDate.getMonth() + goalM);
                      return (
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-muted/50 rounded-xl p-3">
                            <p className="text-xs text-muted-foreground mb-1">{t('planDetail.goalReached')}</p>
                            <p className="font-display text-sm">{format(goalDate, 'MMMM yyyy')}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {goalM < 12
                                ? t('planDetail.months', { count: goalM })
                                : `${(goalM / 12).toFixed(1)} ${t('planDetail.years', { count: (goalM / 12).toFixed(1) })}`}
                            </p>
                          </div>
                          {horizon !== 'goal' && (
                            <div className="rounded-xl p-3" style={{ backgroundColor: plan.color + '15' }}>
                              <p className="text-xs text-muted-foreground mb-1">
                                {t('planDetail.balanceAt', { horizon: t(HORIZON_OPTIONS.find(o => o.key === horizon)?.labelKey ?? '') })}
                              </p>
                              <p className="font-display text-sm" style={{ color: plan.color }}>{fmt(Math.round(balance))}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {balance >= plan.targetAmount
                                  ? t('planDetail.aboveGoalAmount', { amount: fmt(Math.round(balance - plan.targetAmount)) })
                                  : t('planDetail.pctOfGoal', { pct: ((balance / plan.targetAmount) * 100).toFixed(0) })}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* ── Milestones ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-card border border-border rounded-3xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-display text-xl">{t('planDetail.milestones')}</h3>
          {isInvestment && (
            milestoneEdit !== null ? (
              <div className="flex gap-2">
                <button
                  onClick={() => { setMilestoneEdit(null); setMilestoneInput(''); }}
                  className="px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors"
                >
                  {t('planDetail.cancel')}
                </button>
                <button
                  onClick={handleSaveMilestones}
                  disabled={savingMilestones}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingMilestones ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {t('planDetail.save')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setMilestoneEdit([...parsedMilestones])}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" /> {t('planDetail.edit')}
              </button>
            )
          )}
        </div>

        {isInvestment ? (
          <div className="space-y-4">
            {activeMilestones.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground mb-3">{t('planDetail.noMilestones')}</p>
                {milestoneEdit === null && (
                  <button
                    onClick={() => setMilestoneEdit([])}
                    className="text-sm text-primary hover:underline flex items-center gap-1.5 mx-auto"
                  >
                    <PlusCircle className="w-4 h-4" /> {t('planDetail.addMilestones')}
                  </button>
                )}
              </div>
            ) : (
              activeMilestones.map((amount, i) => {
                const reached = plan.currentAmount >= amount;
                const barPct  = Math.min((plan.currentAmount / amount) * 100, 100);
                const goalM   = plan.monthlyContribution > 0
                  ? monthsToGoal(plan.currentAmount, plan.monthlyContribution, amount, PROJECTION_RATES[1], 480)
                  : null;
                const goalDate = goalM !== null ? (() => { const d = new Date(); d.setMonth(d.getMonth() + goalM); return d; })() : null;

                return (
                  <div key={amount} className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-medium transition-colors ${reached ? 'bg-sun text-on-sun' : 'bg-muted text-muted-foreground'}`}
                    >
                      {reached ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-sm">{fmt(amount)}</span>
                        <div className="flex items-center gap-2">
                          {reached ? (
                            <span className="text-xs text-reed font-medium">{t('planDetail.reached')}</span>
                          ) : goalDate ? (
                            <span className="text-xs text-muted-foreground">{t('planDetail.milestoneEta', { date: format(goalDate, 'MMM yyyy', { locale: dateLocale }), rate: PROJECTION_RATE_PCTS.medium.toLocaleString(locale) })}</span>
                          ) : null}
                          {milestoneEdit !== null && (
                            <button
                              onClick={() => setMilestoneEdit(prev => prev!.filter(m => m !== amount))}
                              className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${barPct}%` }}
                          transition={{ duration: 0.8, delay: 0.5 + i * 0.08 }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: reached ? plan.color : plan.color + '99' }}
                        />
                      </div>
                      {!reached && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmt(plan.currentAmount)} / {fmt(amount)} · {barPct.toFixed(0)}%
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {milestoneEdit !== null && (
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{t('planDetail.addMilestone')}</p>
                <div className="flex flex-wrap gap-2">
                  {[5000, 10000, 20000, 50000, 100000].filter(v => !milestoneEdit.includes(v)).map(v => (
                    <button
                      key={v}
                      onClick={() => setMilestoneEdit(prev => [...prev!, v].sort((a, b) => a - b))}
                      className="px-3 py-1.5 text-xs bg-muted hover:bg-primary/10 hover:text-primary border border-border rounded-lg transition-colors"
                    >
                      +{currency}{v >= 1000 ? `${v / 1000}k` : v}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">{currency}</span>
                    <input
                      type="number" min="1" step="500"
                      placeholder={t('planDetail.customAmount')}
                      className="w-full pl-8 pr-4 py-2.5 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
                      value={milestoneInput}
                      onChange={e => setMilestoneInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const v = parseFloat(milestoneInput);
                          if (v > 0 && !milestoneEdit.includes(v)) {
                            setMilestoneEdit(prev => [...prev!, v].sort((a, b) => a - b));
                            setMilestoneInput('');
                          }
                        }
                      }}
                    />
                  </div>
                  <button
                    onClick={() => {
                      const v = parseFloat(milestoneInput);
                      if (v > 0 && !milestoneEdit.includes(v)) {
                        setMilestoneEdit(prev => [...prev!, v].sort((a, b) => a - b));
                        setMilestoneInput('');
                      }
                    }}
                    className="px-4 py-2.5 bg-primary/10 text-primary rounded-xl text-sm hover:bg-primary/20 transition-colors flex items-center gap-1.5"
                  >
                    <PlusCircle className="w-4 h-4" /> {t('planDetail.add')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {savingsMilestones.map((m, i) => (
              <div key={m.pct} className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${m.reached ? 'bg-sun text-on-sun' : 'bg-muted text-muted-foreground'}`}
                >
                  {m.reached ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-display text-sm">{m.pct}{t('planDetail.pctComplete')}</span>
                    <span className="text-sm text-muted-foreground">{fmt(m.amount)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min((plan.currentAmount / m.amount) * 100, 100)}%` }}
                      transition={{ duration: 0.8, delay: 0.5 + i * 0.1 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: plan.color }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
