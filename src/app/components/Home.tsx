import { useEffect, useState } from 'react';
import { useMonth } from '../context/MonthContext';
import { motion } from 'motion/react';
import { AlertTriangle, ArrowRight, CreditCard } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MonthlyReview } from './MonthlyReview';
import { Analytics } from './Analytics';
import { usePlans } from '../hooks/usePlans';
import { useAllocations } from '../hooks/useAllocations';
import { useMonthlyReview } from '../hooks/useMonthlyBudget';
import { useDebts } from '../hooks/useDebts';
import { useLanguage } from '../context/LanguageContext';
import { SetupChecklist } from './SetupChecklist';
import type { OnboardingStep } from '../hooks/useOnboardingNeeded';
import { useMoney } from '../onboarding/useMoney';
import { BankPendingNotice } from './banking/BankPendingNotice';
import { budgetedShareTone, sharePct, spentShareTone, toCents, type Tone } from '../../../shared/budgetStatus';
import { monthLight } from '../../../shared/incomeShare';
import { useMonthSavings } from '../hooks/useMonthSavings';
import { PaidYourselfCard } from './PaidYourselfCard';
import { MonthLightCard } from './MonthLightCard';

// Tones as Remanso tokens (shared/budgetStatus.ts decides the tone). Going
// over is the "watch" state, sun — never red (CLAUDE.md).
const TONE_TEXT: Record<Tone, string> = { good: 'text-reed', warning: 'text-sun-ink', over: 'text-sun-ink', neutral: '' };
const TONE_BAR: Record<Tone, string> = { good: 'bg-reed', warning: 'bg-sun', over: 'bg-sun-ink', neutral: 'bg-muted-foreground/40' };

function greeting(t: (key: string) => string) {
  const h = new Date().getHours();
  if (h < 12) return t('home.greetingMorning');
  if (h < 18) return t('home.greetingAfternoon');
  return t('home.greetingEvening');
}

function monthLabel(key: string, locale: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { month: 'long', year: 'numeric' });
}

function shortMonthLabel(key: string, locale: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { month: 'short' });
}

interface HomeProps {
  onNavigate?: (screen: string) => void;
  /** Setup steps still missing ("Completa tu configuración"). */
  setupMissing?: OnboardingStep[];
  onResumeSetup?: (step: OnboardingStep) => void;
  /** Re-reads the setup status (after a "no cards" / "no loans" answer). */
  onSetupChanged?: () => void;
}

export function Home({ onNavigate, setupMissing = [], onResumeSetup, onSetupChanged = () => {} }: HomeProps) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { language } = useLanguage();
  const { selectedMonth, isCurrentMonth, isFutureMonth } = useMonth();
  const { plans, fetchPlans } = usePlans();
  const { monthlyIncome } = useAllocations();
  const { review, fetchReview } = useMonthlyReview(selectedMonth);
  const { totalOwed, timeline, fetchTimeline, fetchDebts } = useDebts();
  const { savings, refresh: refreshSavings } = useMonthSavings(selectedMonth);
  const month = selectedMonth;
  // Bumped after a bank review: the sections with their own data re-read it.
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAfterBankReview = () => {
    fetchReview(); fetchPlans(); fetchDebts(); fetchTimeline(6); refreshSavings();
    setRefreshKey(k => k + 1);
  };

  useEffect(() => { fetchTimeline(6); }, [fetchTimeline]);

  // Actual income for the month when recorded; otherwise the planned baseline.
  // One household figure, computed by the server over the whole pool (the
  // viewer-filtered income list would show only the viewer's own at
  // shared_stats). monthlyIncome only until the review arrives.
  const displayIncome = review ? review.householdIncome : monthlyIncome;
  const incomeRecorded = review?.householdIncomeSource === 'recorded';

  const totalPlans    = plans.length;
  const completedPlans = plans.filter(p => p.currentAmount >= p.targetAmount).length;
  const totalSaved    = plans.reduce((s, p) => s + p.currentAmount, 0);

  // Missed plan contributions for current month
  const [missedPlans, setMissedPlans] = useState<{ planId: string; title: string; icon: string }[]>([]);
  useEffect(() => {
    if (!isCurrentMonth) { setMissedPlans([]); return; }
    fetch(`/api/plans/monthly-status?month=${selectedMonth}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setMissedPlans(data.status.filter((s: any) => s.status === 'missed').map((s: any) => ({ planId: s.planId, title: s.title, icon: s.icon })));
      })
      .catch(() => {});
  }, [isCurrentMonth, selectedMonth]);

  // Budget comparison uses categorized spending only — uncategorized money has no
  // budget to compare against (it's surfaced separately by the nudge below).
  // The "spent so far" stat still shows the inclusive total (review.totalActual).
  // All compared in integer cents (shared/budgetStatus.ts).
  const budgetedCents   = review ? toCents(review.totalBudgeted) : 0;
  const categorizedCents = review ? toCents(review.totalActual) - toCents(review.unassigned) : 0;
  const overBudgetCount = review?.review.filter(r => r.diff > 0.5).length ?? 0;
  const budgetUsedPct   = sharePct(categorizedCents, budgetedCents);
  const usedTone        = spentShareTone(categorizedCents, budgetedCents);

  // Income vs what's budgeted: the same income the hero shows (the
  // household's for a couple) and the monthly review's "total budgeted".
  const incomeCents   = toCents(displayIncome);
  const budgetedTone  = budgetedShareTone(incomeCents, budgetedCents);
  const budgetedPct   = sharePct(budgetedCents, incomeCents);
  const budgetGap     = Math.abs(incomeCents - budgetedCents) / 100;
  // A budget with nothing coming in: the watch state, said plainly (no "% of 0").
  const noIncome      = budgetedTone !== 'neutral' && incomeCents <= 0;

  // The traffic light: spending vs budget first, then "Págate a ti primero"
  // (what it measures and why: shared/incomeShare.ts, monthLight).
  const light = monthLight({
    spentCents: categorizedCents,
    budgetedCents,
    paidCents: savings ? toCents(savings.paidYourself) : 0,
    goalCents: savings?.payYourselfFirstGoal != null ? toCents(savings.payYourselfFirstGoal) : null,
    closed: !isCurrentMonth && !isFutureMonth,
    goalApplies: savings?.payYourselfFirstApplies ?? true,
  });

  return (
    <div className="space-y-6 pb-8">

      {onResumeSetup && <SetupChecklist missing={setupMissing} onResume={onResumeSetup} onChanged={onSetupChanged} />}

      {/* ── The month at a glance ── */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="space-y-1">
        <p className="text-sm text-muted-foreground">{isCurrentMonth ? greeting(t) : t('home.reviewingPastMonth')}</p>
        <h1 className="text-4xl tracking-tight font-display capitalize">{monthLabel(month, language)}</h1>
      </motion.div>

      {/* ── The one answer: "Te has pagado X de Y este mes" ── */}
      {savings && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.2 }}>
          <PaidYourselfCard
            savings={savings}
            onChanged={refreshSavings}
            onSetAside={onNavigate ? () => onNavigate('dashboard') : undefined}
          />
        </motion.div>
      )}

      {/* ── Traffic light: one sentence on how the month is going ── */}
      {review && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.2 }}>
          <MonthLightCard
            result={light}
            overBudgetCount={light.light === 'over' ? overBudgetCount : 0}
            action={onNavigate && isCurrentMonth && (light.light === 'over' || light.light === 'tight')
              ? { label: t('home.viewExpenses'), onClick: () => onNavigate('activity') }
              : undefined}
          />
        </motion.div>
      )}

      {/* ── The month's figures ── */}
      {review && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.2 }}
          className="bg-card border border-border rounded-3xl p-6 space-y-5"
        >
          <h2 className="text-lg font-semibold">{t('home.monthTitle')}</h2>

          {/* Income vs total budgeted: how much of what comes in is already assigned */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{t('home.incomeVsBudgeted')}</p>
              {budgetedTone !== 'neutral' && !noIncome && (
                <p className={`text-sm font-semibold ${TONE_TEXT[budgetedTone]}`}>{t('home.budgetedPct', { pct: budgetedPct })}</p>
              )}
            </div>
            {budgetedTone === 'neutral' ? (
              <p className="text-sm text-muted-foreground">{t('home.budgetedNeutral')}</p>
            ) : (
              <>
                <p className="text-2xl font-display tabular-nums">
                  {t('home.budgetedOfIncome', { budgeted: fmt(budgetedCents / 100), income: fmt(incomeCents / 100) })}
                </p>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${TONE_BAR[budgetedTone]}`} style={{ width: `${noIncome ? 100 : Math.min(budgetedPct, 100)}%` }} />
                </div>
                <p className={`text-xs ${budgetedTone === 'good' ? 'text-muted-foreground' : TONE_TEXT[budgetedTone]}`}>
                  {noIncome
                    ? t('home.budgetedNoIncome', { amount: fmt(budgetedCents / 100) })
                    : t(`home.budgetedTone.${budgetedTone}`, { amount: fmt(budgetGap) })}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-5 border-t border-border">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('home.monthlyIncome')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(displayIncome)}</p>
              {incomeRecorded && <p className="text-xs text-muted-foreground">{t('home.actualIncome')}</p>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('home.spentSoFar')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(review.totalActual)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('home.budgetUsed')}</p>
              <p className={`text-2xl font-display tabular-nums ${usedTone === 'good' ? '' : TONE_TEXT[usedTone]}`}>{budgetUsedPct}%</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('home.totalSaved')}</p>
              <p className="text-2xl font-display tabular-nums">{fmt(totalSaved)}</p>
              <p className="text-xs text-muted-foreground">{t('home.plansCompleted', { done: completedPlans, total: totalPlans })}</p>
            </div>
          </div>

          {/* The Generosity line this month (LPBETA-10): said plainly, no judgement at 0. */}
          {savings && (
            <div className="flex items-center justify-between gap-3 pt-5 border-t border-border text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-sun" aria-hidden="true" /> {t('home.generosityLabel')}
              </span>
              <span className="tabular-nums">{t('home.gives', { amount: fmt(savings.generosityAmount) })}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* ── Committed future: debt goes below the month (LPBETA-07) ── */}
      {totalOwed > 0 && timeline.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, duration: 0.2 }}
          className="bg-card border border-border rounded-3xl p-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-pool-soft text-pool flex items-center justify-center shrink-0">
              <CreditCard className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold">{t('home.committedFutureTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('home.committedFutureSubtitle', { pct: timeline[0].pctCommitted })}
              </p>
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate('debts')}
                className="text-xs text-primary flex items-center gap-1 hover:underline shrink-0"
              >
                {t('home.viewDebts')} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-6 gap-2">
            {timeline.map(p => (
              <div key={p.period} className="text-center">
                <div className="h-16 flex items-end justify-center">
                  <div
                    className="w-full max-w-8 bg-pool/60 rounded-t-md transition-all"
                    style={{ height: `${Math.min(100, Math.max(2, p.pctCommitted))}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1 capitalize">{shortMonthLabel(p.period, language)}</p>
                <p className="text-xs font-display tabular-nums">{p.pctCommitted}%</p>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ── Uncategorized spending nudge ── */}
      {review && review.unassigned > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}
          className="flex items-start gap-3 bg-sun-soft text-sun-ink rounded-2xl px-5 py-4"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium">
              {t('home.unassignedTitle', { amount: fmt(review.unassigned) })}
            </p>
            <p className="text-sm opacity-80 mt-0.5">
              {t('home.unassignedDesc')}
            </p>
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('activity')}
              className="text-xs flex items-center gap-1 hover:underline shrink-0"
            >
              {t('home.viewExpenses')} <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </motion.div>
      )}

      {/* ── Bank movements waiting for review (the connection's owner only) ── */}
      <BankPendingNotice onChanged={refreshAfterBankReview} />

      {/* ── Missed plan contributions alert ── */}
      {missedPlans.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div className="flex items-start gap-3 bg-sun-soft text-sun-ink rounded-2xl px-5 py-4">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">
                {t('home.missedPlanContribs', { count: missedPlans.length })}
              </p>
              <p className="text-sm opacity-80 mt-0.5">
                {missedPlans.map(p => `${p.icon} ${p.title}`).join(' · ')}
              </p>
            </div>
            {onNavigate && (
              <button
                onClick={() => onNavigate('dashboard')}
                className="text-xs flex items-center gap-1 hover:underline shrink-0"
              >
                {t('home.reviewPlans')} <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Monthly Review ── */}
      <MonthlyReview key={`review-${refreshKey}`} />

      {/* ── Temporal analysis ── */}
      <Analytics key={`analytics-${refreshKey}`} />

    </div>
  );
}
