import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, Calendar, TrendingUp, DollarSign, Target,
  Pencil, Trash2, CheckCircle2, Loader2, X, Check,
  PlusCircle, ChevronDown, ChevronUp, PiggyBank,
  AlertTriangle, RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ResponsiveContainer, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { differenceInDays, format } from 'date-fns';
import { toast } from 'sonner';
import { usePlans, getPlanStatus } from '../hooks/usePlans';
import { useTranslation } from 'react-i18next';
import { currentMonthKey, monthLabel } from '../context/MonthContext';
import { useLanguage } from '../context/LanguageContext';

const COLOR_OPTIONS = [
  '#1E3A8A','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#3B82F6','#EC4899','#06B6D4','#84CC16','#F97316',
];

// ── Projection math ──────────────────────────────────────────────────────────

function compoundBalance(
  current: number,
  monthly: number,
  months: number,
  annualRate: number,
): number {
  if (annualRate === 0) return current + monthly * months;
  const r = annualRate / 12;
  return current * Math.pow(1 + r, months) + monthly * (Math.pow(1 + r, months) - 1) / r;
}

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
  rates: [number, number, number] = [0.01, 0.05, 0.15],
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
    const label = m === 0 ? 'Now'
      : m % 12 === 0 ? `Y${m / 12}`
      : `M${m}`;
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

function ProjectionTooltip({ active, payload, label, target, t }: any) {
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
              <span className="font-medium ml-auto">€{Math.round(p.value).toLocaleString()}</span>
            </div>
            {overGoal && (
              <p className="text-xs text-secondary pl-4">{t('planDetail.aboveGoalAmount', { amount: Math.round(gain).toLocaleString() })}</p>
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
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
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
  type MonthlyContribStatus = { status: 'contributed' | 'missed' | 'pending'; expectedAmount: number; depositedAmount: number } | null;
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
      toast.success(t('planDetail.contributionAdded', { amount: amount.toLocaleString(), title: plan.title }));
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
  const projRates: [number, number, number] = planType === 'wealth' ? [0.05, 0.12, 0.25] : [0.01, 0.05, 0.15];

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
    const month = currentMonthKey();
    const res = await fetch(`/api/plans/monthly-status?month=${month}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    const entry = data.status.find((s: any) => s.planId === pid);
    setMonthlyStatus(entry ? { status: entry.status, expectedAmount: entry.expectedAmount, depositedAmount: entry.depositedAmount } : null);
  };

  useEffect(() => { if (planId) fetchMonthlyStatus(planId); }, [planId]);

  const handleMonthlyDeposit = async () => {
    if (!plan) return;
    const amount = parseFloat(depositAmount) || plan.monthlyContribution;
    if (!amount || amount <= 0) return;
    setDepositing(true);
    const month = currentMonthKey();
    const res = await fetch('/api/plan-deposits/confirm', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ month, deposits: [{ planId: plan.id, amount }] }),
    });
    setDepositing(false);
    if (res.ok) {
      await fetchPlans();
      setMonthlyStatus(prev => prev ? { ...prev, status: 'contributed', depositedAmount: amount } : prev);
      setShowDepositPanel(false);
      setDepositAmount('');
      toast.success(t('planDetail.contribRegistered'));
    } else {
      toast.error('Failed to register contribution');
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
      toast.success(t('planDetail.allocationSynced', { amount: plan.monthlyContribution.toLocaleString() }));
    } else {
      toast.error('Failed to sync allocation');
    }
  };

  const handleAdjustQuota = async (newMonthly: number) => {
    if (!plan) return;
    setAdjustingQuota(true);
    const result = await updatePlan(plan.id, { monthlyContribution: newMonthly });
    setAdjustingQuota(false);
    if ('error' in result && result.error) { toast.error(result.error as string); return; }
    toast.success(t('planDetail.quotaUpdated', { amount: newMonthly.toLocaleString() }));
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
      projRates,
    );
  }, [plan?.currentAmount, effectiveMonthly, plan?.targetAmount, plan?.goalClass, horizon]);

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

  const scenarioConfig = planType === 'wealth'
    ? [
        { pill: t('planDetail.conservative'), name: t('planDetail.conservative'), rate: projRates[0], stroke: '#F87171', dot: 'bg-red-400',     pillCls: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',         textColor: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-950/20' },
        { pill: t('planDetail.expected'),      name: t('planDetail.expected'),     rate: projRates[1], stroke: '#FBBF24', dot: 'bg-amber-400',   pillCls: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800', textColor: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-950/20' },
        { pill: t('planDetail.aggressive'),    name: t('planDetail.aggressive'),   rate: projRates[2], stroke: '#34D399', dot: 'bg-emerald-400', pillCls: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800', textColor: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
      ]
    : [
        { pill: t('planDetail.pessimistic'), name: t('planDetail.pessimistic'), rate: projRates[0], stroke: '#F87171', dot: 'bg-red-400',     pillCls: 'bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',         textColor: 'text-red-600 dark:text-red-400',     bg: 'bg-red-50 dark:bg-red-950/20' },
        { pill: t('planDetail.base'),        name: t('planDetail.base'),        rate: projRates[1], stroke: '#FBBF24', dot: 'bg-amber-400',   pillCls: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800', textColor: 'text-amber-600 dark:text-amber-400',  bg: 'bg-amber-50 dark:bg-amber-950/20' },
        { pill: t('planDetail.optimistic'),  name: t('planDetail.optimistic'),  rate: projRates[2], stroke: '#34D399', dot: 'bg-emerald-400', pillCls: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800', textColor: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/20' },
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
                className="px-3 py-2 bg-destructive text-white rounded-lg text-sm hover:bg-destructive/90 transition-colors flex items-center gap-1"
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
            className="bg-card border border-primary/30 rounded-2xl p-6 space-y-5"
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
                    { value: 'safety',     labelKey: 'planDetail.typeSafety',      icon: '🛡️', active: 'bg-emerald-500 text-white border-emerald-500' },
                    { value: 'savings',    labelKey: 'planDetail.typeSavings',     icon: '🎯', active: 'bg-primary text-white border-primary' },
                    { value: 'investment', labelKey: 'planDetail.typeInvestment',  icon: '📈', active: 'bg-secondary text-white border-secondary' },
                    { value: 'wealth',     labelKey: 'planDetail.typeWealth',      icon: '🚀', active: 'bg-amber-500 text-white border-amber-500' },
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
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
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
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
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
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
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
                className="flex-1 py-2.5 bg-gradient-to-r from-primary to-secondary text-white rounded-xl hover:shadow-md transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
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
            className="flex items-center gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 rounded-xl px-4 py-3"
          >
            <RefreshCw className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400 flex-1">
              {t('planDetail.syncAllocationBanner', { current: plan.monthlyContribution.toLocaleString() })}
            </p>
            <button
              onClick={handleSyncAllocation}
              disabled={syncingAllocation}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50 shrink-0"
            >
              {syncingAllocation ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {t('planDetail.syncAllocationBtn')}
            </button>
            <button onClick={() => setSyncAllocationId(null)} className="w-7 h-7 flex items-center justify-center text-amber-500 hover:text-amber-700 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Hero Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="text-primary-foreground rounded-3xl p-8 md:p-10 shadow-2xl relative overflow-hidden"
        style={{ background: `linear-gradient(135deg, ${plan.color}, ${plan.color}cc)` }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-black/10 rounded-full blur-3xl -ml-24 -mb-24" />
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
            <div className="text-7xl">{plan.icon}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="px-4 py-2 rounded-full text-sm bg-white/20 text-white">
                {status === 'completed' && t('planDetail.statusCompleted')}
                {status === 'on-track'  && t('planDetail.statusOnTrack')}
                {status === 'ahead'     && t('planDetail.statusAhead')}
                {status === 'behind'    && t('planDetail.statusBehind')}
              </div>
              {plan.currentAmount < plan.targetAmount && (
                <button
                  onClick={() => setShowContribute(v => !v)}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-full text-sm text-white transition-colors flex items-center gap-2"
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
                className="mb-6 overflow-hidden"
              >
                <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-5 space-y-3">
                  <p className="text-sm font-medium opacity-90">{t('planDetail.howMuchAdding')}</p>
                  <div className="flex gap-3">
                    <div className="flex items-center gap-2 bg-white/20 rounded-xl px-4 py-2.5 flex-1">
                      <span className="text-white/70 text-sm">€</span>
                      <input
                        type="number" min="0" step="50"
                        placeholder={String(plan.monthlyContribution || 100)}
                        className="flex-1 bg-transparent outline-none text-white placeholder:text-white/50 text-lg font-display"
                        value={contribAmount}
                        onChange={e => setContribAmount(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleContribute(); if (e.key === 'Escape') setShowContribute(false); }}
                        autoFocus
                      />
                    </div>
                    <button
                      onClick={handleContribute} disabled={contributing}
                      className="px-5 py-2.5 bg-white text-primary rounded-xl font-medium text-sm hover:bg-white/90 transition-colors flex items-center gap-2 disabled:opacity-60"
                      style={{ color: plan.color }}
                    >
                      {contributing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      {t('planDetail.confirm')}
                    </button>
                    <button
                      onClick={() => setShowContribute(false)}
                      className="w-10 h-10 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center transition-colors shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[50, 100, 200, 500].map(v => (
                      <button
                        key={v}
                        onClick={() => setContribAmount(String(v))}
                        className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs text-white transition-colors"
                      >
                        +€{v}
                      </button>
                    ))}
                    {plan.monthlyContribution > 0 && ![50, 100, 200, 500].includes(plan.monthlyContribution) && (
                      <button
                        onClick={() => setContribAmount(String(plan.monthlyContribution))}
                        className="px-3 py-1.5 bg-white/15 hover:bg-white/25 rounded-lg text-xs text-white transition-colors"
                      >
                        +€{plan.monthlyContribution} {t('planDetail.planned')}
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div>
              <p className="text-sm opacity-75 mb-2">{t('planDetail.currentProgress')}</p>
              <p className="text-4xl font-display mb-1">€{plan.currentAmount.toLocaleString()}</p>
              <p className="text-sm opacity-75">{t('planDetail.of')} €{plan.targetAmount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm opacity-75 mb-2">{t('planDetail.remaining')}</p>
              <p className="text-4xl font-display mb-1">€{remaining.toLocaleString()}</p>
              <p className="text-sm opacity-75">
                {monthsLeft !== null
                  ? t('planDetail.monthsLeft', { count: monthsLeft })
                  : t('planDetail.noDeadline')}
              </p>
            </div>
            <div>
              <p className="text-sm opacity-75 mb-2">{t('planDetail.monthlyContribution')}</p>
              <p className="text-4xl font-display mb-1">€{plan.monthlyContribution.toLocaleString()}</p>
              <p className="text-sm opacity-75">{t('planDetail.perMonth')}</p>
            </div>
          </div>

          <div className="relative h-4 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(progress, 100)}%` }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              className="absolute top-0 left-0 h-full bg-white/70 rounded-full"
            />
          </div>
          <p className="text-sm opacity-75 mt-2">{t('planDetail.progressPct', { progress: progress.toFixed(1) })}</p>
        </div>
      </motion.div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card border border-border rounded-2xl p-6">
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="bg-card border border-border rounded-2xl p-6">
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

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-accent" />
            </div>
            <p className="text-sm text-muted-foreground">{t('planDetail.alreadySaved')}</p>
          </div>
          <p className="text-2xl font-display">€{plan.currentAmount.toLocaleString()}</p>
          <button
            onClick={() => setShowContribute(true)}
            className="text-sm text-primary mt-1 hover:underline flex items-center gap-1"
          >
            <PlusCircle className="w-3 h-3" /> {t('planDetail.addContributionBtn')}
          </button>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">{t('planDetail.stillNeeded')}</p>
          </div>
          <p className="text-2xl font-display">€{remaining.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('planDetail.pctToGo', { pct: (100 - Math.min(progress, 100)).toFixed(0) })}</p>
        </motion.div>
      </div>

      {/* ── Monthly Contribution Status ── */}
      {monthlyStatus !== null && plan.currentAmount < plan.targetAmount && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
          <div className={`rounded-2xl border-2 p-5 transition-colors ${
            monthlyStatus.status === 'contributed'
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
              : monthlyStatus.status === 'missed'
              ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
              : 'bg-card border-border'
          }`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                {monthlyStatus.status === 'contributed' && <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />}
                {monthlyStatus.status === 'missed'      && <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />}
                {monthlyStatus.status === 'pending'     && <div className="w-5 h-5 rounded-full border-2 border-primary/40 shrink-0" />}
                <div>
                  <p className="font-medium text-sm">
                    {monthlyStatus.status === 'contributed' && t('planDetail.monthContributed', { amount: monthlyStatus.depositedAmount.toLocaleString() })}
                    {monthlyStatus.status === 'missed'      && t('planDetail.monthMissed')}
                    {monthlyStatus.status === 'pending'     && t('planDetail.monthPending', { amount: monthlyStatus.expectedAmount.toLocaleString() })}
                  </p>
                  <p className="text-xs text-muted-foreground capitalize mt-0.5">
                    {monthLabel(currentMonthKey(), locale)}
                  </p>
                </div>
              </div>
              {monthlyStatus.status !== 'contributed' && !showDepositPanel && (
                <button
                  onClick={() => { setDepositAmount(String(monthlyStatus.expectedAmount)); setShowDepositPanel(true); }}
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
                        <span className="text-muted-foreground text-sm">€</span>
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
                            €{v.toLocaleString()}
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
          className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 space-y-4"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-display text-sm text-amber-800 dark:text-amber-300">{t('planDetail.recoveryTitle')}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{t('planDetail.recoverySubtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Option A: Catch up */}
            <div className="bg-white dark:bg-amber-950/30 rounded-xl p-4 border border-amber-200 dark:border-amber-700">
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
                className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-medium transition-colors"
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
                <div className="bg-white dark:bg-amber-950/30 rounded-xl p-4 border border-amber-200 dark:border-amber-700">
                  <p className="font-medium text-sm mb-1">{t('planDetail.optionAdjustQuota')}</p>
                  <p className="text-xs text-muted-foreground mb-1">{t('planDetail.optionAdjustQuotaDesc')}</p>
                  <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
                    {t('planDetail.newQuotaLabel')}: <strong>€{newQuota.toLocaleString()}/mo</strong>
                  </p>
                  <button
                    onClick={() => handleAdjustQuota(newQuota)}
                    disabled={adjustingQuota}
                    className="w-full py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {adjustingQuota ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {t('planDetail.adjustQuotaBtn', { amount: newQuota.toLocaleString() })}
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
                    ? scenarioConfig.map(s => s.pill).join(' · ')
                    : `€${effectiveMonthly.toLocaleString()}/mo — ${plan.currentAmount < plan.targetAmount && projectedCompletion ? `${format(projectedCompletion, 'MMM yyyy')}` : t('planDetail.goalReached')}`}
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
                        <span className="text-sm text-muted-foreground">€</span>
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
                            title="Reset to saved value"
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
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t('planDetail.simulationNote', { amount: plan.monthlyContribution.toLocaleString() })}
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
                          <div className={`w-2 h-2 rounded-full ${s.dot}`} />
                          {s.pill}
                        </div>
                      ))}
                    </div>
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
                          tickFormatter={v => v >= 1000 ? `€${(v / 1000).toFixed(0)}k` : `€${v}`}
                          width={60}
                        />
                        <Tooltip content={<ProjectionTooltip target={plan.targetAmount} t={t} />} />

                        {isInvestment && parsedMilestones.filter(m => m !== plan.targetAmount && m > 0).map(amount => (
                          <ReferenceLine
                            key={amount}
                            y={amount}
                            stroke={plan.color}
                            strokeDasharray="2 5"
                            strokeOpacity={0.3}
                            label={{
                              value: amount >= 1000 ? `€${(amount / 1000).toFixed(0)}k` : `€${amount}`,
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
                            value: `Goal €${plan.targetAmount.toLocaleString()}`,
                            position: 'insideTopRight',
                            fontSize: 11,
                            fill: plan.color,
                            opacity: 0.8,
                          }}
                        />

                        {horizon !== 'goal' && (() => {
                          const goalMonth = isInvestment
                            ? monthsToGoal(plan.currentAmount, effectiveMonthly, plan.targetAmount, projRates[1], horizon as number)
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
                            <Line type="monotone" dataKey="pessimistic" name={scenarioConfig[0].name} stroke={scenarioConfig[0].stroke} strokeWidth={2}   dot={false} activeDot={{ r: 4, fill: scenarioConfig[0].stroke }} />
                            <Line type="monotone" dataKey="base"        name={scenarioConfig[1].name} stroke={scenarioConfig[1].stroke} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: scenarioConfig[1].stroke }} />
                            <Line type="monotone" dataKey="optimistic"  name={scenarioConfig[2].name} stroke={scenarioConfig[2].stroke} strokeWidth={2}   dot={false} activeDot={{ r: 4, fill: scenarioConfig[2].stroke }} />
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
                      {scenarioConfig.map(({ name, rate, textColor, bg }) => {
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
                                <p className={`font-display text-sm ${textColor}`}>€{Math.round(balance).toLocaleString()}</p>
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
                              <p className="font-display text-sm" style={{ color: plan.color }}>€{Math.round(balance).toLocaleString()}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {balance >= plan.targetAmount
                                  ? t('planDetail.aboveGoalAmount', { amount: Math.round(balance - plan.targetAmount).toLocaleString() })
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
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="bg-card border border-border rounded-2xl p-6">
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
                  className="px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
                  ? monthsToGoal(plan.currentAmount, plan.monthlyContribution, amount, projRates[1], 480)
                  : null;
                const goalDate = goalM !== null ? (() => { const d = new Date(); d.setMonth(d.getMonth() + goalM); return d; })() : null;

                return (
                  <div key={amount} className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-medium transition-colors ${reached ? 'text-white' : 'bg-muted text-muted-foreground'}`}
                      style={reached ? { backgroundColor: plan.color } : {}}
                    >
                      {reached ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-display text-sm">€{amount.toLocaleString()}</span>
                        <div className="flex items-center gap-2">
                          {reached ? (
                            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{t('planDetail.reached')}</span>
                          ) : goalDate ? (
                            <span className="text-xs text-muted-foreground">~{format(goalDate, 'MMM yyyy')} at {projRates[1]*100}%</span>
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
                          €{plan.currentAmount.toLocaleString()} / €{amount.toLocaleString()} · {barPct.toFixed(0)}%
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
                      +€{v >= 1000 ? `${v / 1000}k` : v}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
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
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${m.reached ? 'text-white' : 'bg-muted text-muted-foreground'}`}
                  style={m.reached ? { backgroundColor: plan.color } : {}}
                >
                  {m.reached ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-display text-sm">{m.pct}{t('planDetail.pctComplete')}</span>
                    <span className="text-sm text-muted-foreground">€{m.amount.toLocaleString()}</span>
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
