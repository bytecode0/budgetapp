import { useTranslation } from 'react-i18next';
import { CheckCircle2, TrendingUp, Clock, Target, Loader2, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { usePlans, getPlanStatus } from '../hooks/usePlans';
import { useMoney } from '../onboarding/useMoney';

// Plan status, always icon + word (LPBETA-27). Behind schedule is a "watch"
// state, not an error; a completed plan is the warm sun.
function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const cfg = status === 'completed' ? { cls: 'bg-sun-soft text-sun-ink', Icon: CheckCircle2, key: 'dashboard.statusCompleted' }
    : status === 'ahead' ? { cls: 'bg-reed-soft text-reed', Icon: TrendingUp, key: 'dashboard.statusAhead' }
    : status === 'behind' ? { cls: 'bg-sun-soft text-sun-ink', Icon: Clock, key: 'dashboard.statusBehind' }
    : { cls: 'bg-reed-soft text-reed', Icon: CheckCircle2, key: 'dashboard.statusOnTrack' };
  const { cls, Icon, key } = cfg;
  return (
    <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1 shrink-0 ${cls}`}>
      <Icon className="w-3.5 h-3.5" /> {t(key)}
    </div>
  );
}

const GOAL_CLASS_KEY: Record<string, string> = {
  safety: 'planDetail.typeSafety',
  savings: 'planDetail.typeSavings',
  investment: 'planDetail.typeInvestment',
  wealth: 'planDetail.typeWealth',
};

export function PlanningDashboard({ onNavigate, onViewPlan }: { onNavigate?: (screen: string) => void; onViewPlan?: (planId: string) => void }) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { plans, loading } = usePlans();

  const totalPlans = plans.length;
  const plansOnTrack = plans.filter((p) => {
    const s = getPlanStatus(p);
    return s === 'on-track' || s === 'completed' || s === 'ahead';
  }).length;

  const overallProgress = totalPlans === 0 ? 0 : Math.round(
    plans.reduce((sum, p) => sum + Math.min(p.currentAmount / Math.max(p.targetAmount, 1), 1), 0) / totalPlans * 100
  );

  const totalSaved = plans.reduce((s, p) => s + p.currentAmount, 0);
  const totalMonthlyContributions = plans.reduce((s, p) => s + p.monthlyContribution, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const ring = 2 * Math.PI * 34;

  return (
    <div className="space-y-6 pb-24">
      {/* Title */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }} className="space-y-2">
        <h1 className="text-4xl tracking-tight font-display">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">
          {totalPlans > 0 ? t('dashboard.plansProgressing', { count: plansOnTrack, total: totalPlans }) : t('dashboard.emptyStateDesc')}
        </p>
      </motion.div>

      {/* Summary: the money you have set aside for yourself */}
      {totalPlans > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2, ease: 'easeOut' }}
          className="bg-card border border-border rounded-3xl p-6 md:p-8 flex flex-wrap items-center justify-between gap-6"
        >
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('dashboard.totalSaved')}</p>
            <p className="text-5xl font-display tabular-nums">{fmt(totalSaved)}</p>
            <p className="text-sm text-muted-foreground">
              {t('dashboard.activePlansCount', { count: totalPlans })}
              {totalMonthlyContributions > 0 && <> · {fmt(totalMonthlyContributions)}{t('currency.perMonthSuffix')}</>}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20" role="img" aria-label={`${t('dashboard.overallCompletion')}: ${overallProgress}%`}>
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
                <circle cx="40" cy="40" r="34" strokeWidth="8" fill="none" className="stroke-surface-sunk" />
                <motion.circle
                  cx="40" cy="40" r="34" strokeWidth="8" fill="none" strokeLinecap="round"
                  className="stroke-primary"
                  strokeDasharray={ring}
                  initial={{ strokeDashoffset: ring }}
                  animate={{ strokeDashoffset: ring * (1 - overallProgress / 100) }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-display text-lg tabular-nums">{overallProgress}%</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-[10rem]">{t('dashboard.overallCompletion')}</p>
          </div>
        </motion.div>
      )}

      {/* Plans */}
      <div className="space-y-4">
        {totalPlans > 0 && <h2 className="text-2xl font-display">{t('dashboard.yourLifePlans')}</h2>}

        {plans.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: 'easeOut' }}
            className="text-center py-16 px-6 space-y-3"
          >
            <div className="w-16 h-16 bg-pool-soft text-pool rounded-3xl flex items-center justify-center mx-auto">
              <Target className="w-8 h-8" />
            </div>
            <p className="font-display text-lg">{t('dashboard.noPlansYet')}</p>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">{t('dashboard.emptyStateDesc')}</p>
            <button
              onClick={() => onNavigate?.('create-plan')}
              className="h-11 px-6 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium"
            >
              {t('dashboard.createFirstPlan')}
            </button>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.map((plan, index) => {
              const progress = plan.targetAmount > 0 ? (plan.currentAmount / plan.targetAmount) * 100 : 0;
              const status = getPlanStatus(plan);
              const daysLeft = plan.deadline ? differenceInDays(new Date(plan.deadline), new Date()) : null;
              const monthsLeft = daysLeft !== null ? Math.max(0, Math.ceil(daysLeft / 30)) : null;
              const classKey = GOAL_CLASS_KEY[plan.goalClass || 'savings'] ?? GOAL_CLASS_KEY.savings;

              return (
                <motion.button
                  type="button"
                  key={plan.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(0.1 + index * 0.05, 0.4), ease: 'easeOut' }}
                  onClick={() => onViewPlan?.(plan.id)}
                  className="text-left bg-card border border-border rounded-3xl p-6 hover:border-line-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <div className="flex items-start justify-between gap-3 mb-5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                        style={{ backgroundColor: plan.color + '26' }}
                      >
                        {plan.icon}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-lg truncate">{plan.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{plan.description || t(classKey)}</p>
                      </div>
                    </div>
                    <StatusBadge status={status} t={t} />
                  </div>

                  <div className="space-y-3">
                    <div className="h-2 bg-surface-sunk rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(Math.min(progress, 100))} aria-valuemin={0} aria-valuemax={100} aria-label={plan.title}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(progress, 100)}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                        className="h-full rounded-full"
                        style={{ backgroundColor: plan.color }}
                      />
                    </div>

                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-2xl font-display tabular-nums">{fmt(plan.currentAmount)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {t('dashboard.ofTarget', { amount: fmt(plan.targetAmount) })} · {progress.toFixed(0)}{t('dashboard.pctComplete')}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-0.5">
                        <p>{monthsLeft !== null ? t('dashboard.months', { count: monthsLeft }) : t('dashboard.noDeadline')}</p>
                        {plan.monthlyContribution > 0 && (
                          <p className="tabular-nums">{fmt(plan.monthlyContribution)}{t('currency.perMonthSuffix')}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {status === 'behind' && (
                    <p className="mt-4 pt-4 border-t border-border flex items-center gap-2 text-sm text-sun-ink">
                      <Clock className="w-4 h-4 shrink-0" />
                      {t('dashboard.behindSchedule')}
                    </p>
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <motion.button
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.2, ease: 'easeOut' }}
        onClick={() => onNavigate?.('create-plan')}
        aria-label={t('dashboard.createFirstPlan')}
        style={{ right: 'calc(1.5rem + env(safe-area-inset-right, 0px))', bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        className="fixed w-16 h-16 bg-primary text-primary-foreground rounded-full shadow-soft hover:-translate-y-0.5 transition-transform flex items-center justify-center z-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Plus className="w-7 h-7" />
      </motion.button>
    </div>
  );
}
