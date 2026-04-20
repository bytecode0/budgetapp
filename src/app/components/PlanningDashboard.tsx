import { useTranslation } from 'react-i18next';
import { CheckCircle2, TrendingUp, AlertCircle, Sparkles, Target, TrendingDown, Loader2, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { differenceInDays } from 'date-fns';
import { usePlans, getPlanStatus } from '../hooks/usePlans';

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  if (status === 'completed') return (
    <div className="px-3 py-1 rounded-full text-xs flex items-center gap-1 bg-secondary/10 text-secondary">
      <CheckCircle2 className="w-3 h-3" /> {t('dashboard.statusCompleted')}
    </div>
  );
  if (status === 'ahead') return (
    <div className="px-3 py-1 rounded-full text-xs flex items-center gap-1 bg-accent/10 text-accent">
      <TrendingUp className="w-3 h-3" /> {t('dashboard.statusAhead')}
    </div>
  );
  if (status === 'behind') return (
    <div className="px-3 py-1 rounded-full text-xs flex items-center gap-1 bg-destructive/10 text-destructive">
      <TrendingDown className="w-3 h-3" /> {t('dashboard.statusBehind')}
    </div>
  );
  return (
    <div className="px-3 py-1 rounded-full text-xs flex items-center gap-1 bg-secondary/10 text-secondary">
      <CheckCircle2 className="w-3 h-3" /> {t('dashboard.statusOnTrack')}
    </div>
  );
}

export function PlanningDashboard({ onNavigate, onViewPlan }: { onNavigate?: (screen: string) => void; onViewPlan?: (planId: string) => void }) {
  const { t } = useTranslation();
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

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-primary/90 text-primary-foreground rounded-3xl p-8 md:p-12 shadow-2xl"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full blur-3xl -mr-48 -mt-48" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary/20 rounded-full blur-3xl -ml-32 -mb-32" />

        <div className="relative z-10">
          <div className="flex items-start justify-between mb-8">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <p className="text-sm opacity-90 mb-1">{t('dashboard.title')}</p>
                  <h1 className="text-4xl md:text-5xl font-display tracking-tight">
                    {totalPlans === 0
                      ? t('dashboard.taglineGetStarted')
                      : overallProgress >= 80
                      ? t('dashboard.taglineLookingGreat')
                      : overallProgress >= 40
                      ? t('dashboard.taglineMakingProgress')
                      : t('dashboard.taglineBuildingMomentum')}
                  </h1>
                </div>
              </div>
              {totalPlans > 0 ? (
                <p className="text-lg opacity-90 max-w-2xl">
                  {t('dashboard.plansProgressing', { count: plansOnTrack, total: totalPlans })}
                </p>
              ) : (
                <p className="text-lg opacity-90 max-w-2xl">
                  {t('dashboard.emptyStateDesc')}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-8 flex-wrap">
            <div className="relative w-32 h-32">
              <svg className="w-32 h-32 transform -rotate-90">
                <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="8" fill="none" className="opacity-20" />
                <motion.circle
                  cx="64" cy="64" r="56"
                  stroke="currentColor" strokeWidth="8" fill="none"
                  strokeDasharray={`${2 * Math.PI * 56}`}
                  initial={{ strokeDashoffset: 2 * Math.PI * 56 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - overallProgress / 100) }}
                  transition={{ duration: 1.5, ease: 'easeOut' }}
                  strokeLinecap="round"
                  className="text-white drop-shadow-lg"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-display">{overallProgress}%</span>
              </div>
            </div>
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-secondary rounded-full animate-pulse" />
                <span className="text-sm opacity-90">{t('dashboard.overallCompletion')}</span>
              </div>
              <p className="text-sm opacity-75">{t('dashboard.overallCompletionSubtitle')}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Stats Row */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-secondary/10 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-secondary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.activePlans')}</p>
              <p className="font-display text-2xl">{totalPlans}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {totalPlans === 0
              ? t('dashboard.noPlansYet')
              : t('dashboard.onTrackCount', { count: plansOnTrack })}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Target className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.totalSaved')}</p>
              <p className="font-display text-2xl">€{totalSaved.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('dashboard.acrossAllPlans')}</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-accent/10 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t('dashboard.monthlyContributions')}</p>
              <p className="font-display text-2xl">€{totalMonthlyContributions.toLocaleString()}</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{t('dashboard.committedToPlans')}</p>
        </div>
      </motion.div>


      {/* Life Plans Grid */}
      <div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mb-4"
        >
          <h2 className="text-2xl font-display mb-1">{t('dashboard.yourLifePlans')}</h2>
          <p className="text-muted-foreground">{t('dashboard.activeGoals')}</p>
        </motion.div>

        {plans.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="bg-card border border-dashed border-border rounded-2xl p-12 text-center"
          >
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Target className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-display text-xl mb-2">{t('dashboard.noPlansYet')}</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              {t('dashboard.emptyStateDesc')}
            </p>
            <button
              onClick={() => onNavigate?.('create-plan')}
              className="px-6 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl hover:shadow-md transition-all"
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

              return (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.4 + index * 0.1 }}
                  whileHover={{ y: -4, transition: { duration: 0.2 } }}
                  onClick={() => onViewPlan?.(plan.id)}
                  className="bg-card border border-border rounded-2xl p-6 shadow-md hover:shadow-xl transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                        style={{ backgroundColor: plan.color + '20' }}
                      >
                        {plan.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display text-lg group-hover:text-primary transition-colors">{plan.title}</h3>
                          {(() => {
                            const gc = plan.goalClass || 'savings';
                            const cfg: Record<string, { cls: string; label: string }> = {
                              safety:     { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400', label: '🛡️ Safety' },
                              savings:    { cls: 'bg-primary/10 text-primary', label: '🎯 Savings' },
                              investment: { cls: 'bg-secondary/10 text-secondary', label: '📈 Investment' },
                              wealth:     { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400', label: '🚀 Wealth' },
                            };
                            const { cls, label } = cfg[gc] ?? cfg.savings;
                            return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>;
                          })()}
                        </div>
                        {plan.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{plan.description}</p>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={status} t={t} />
                  </div>

                  <div className="space-y-3">
                    <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(progress, 100)}%` }}
                        transition={{ duration: 1.2, delay: 0.5 + index * 0.1, ease: 'easeOut' }}
                        className="absolute top-0 left-0 h-full rounded-full"
                        style={{
                          background: `linear-gradient(to right, ${plan.color}, ${plan.color}aa)`,
                        }}
                      />
                    </div>

                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">{progress.toFixed(0)}{t('dashboard.pctComplete')}</p>
                        <p className="text-2xl font-display" style={{ color: plan.color }}>€{plan.currentAmount.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">of €{plan.targetAmount.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        {monthsLeft !== null ? (
                          <>
                            <p className="text-sm text-muted-foreground mb-1">{t('dashboard.timeline')}</p>
                            <p className="font-display">{t('dashboard.months', { count: monthsLeft })}</p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-muted-foreground mb-1">{t('dashboard.noDeadline')}</p>
                          </>
                        )}
                        {plan.monthlyContribution > 0 && (
                          <p className="text-xs text-muted-foreground">€{plan.monthlyContribution.toLocaleString()}/mo</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {status === 'behind' && (
                    <div className="mt-4 pt-4 border-t border-border">
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4" />
                        <span>{t('dashboard.behindSchedule')}</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* FAB */}
      <motion.button
        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
        onClick={() => onNavigate?.('create-plan')}
        whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
        className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center z-40 group"
      >
        <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
      </motion.button>
    </div>
  );
}
