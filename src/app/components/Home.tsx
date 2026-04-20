import { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, ArrowRight, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MonthlyReview } from './MonthlyReview';
import { usePlans } from '../hooks/usePlans';
import { useAllocations } from '../hooks/useAllocations';
import { useMonthlyReview } from '../hooks/useMonthlyBudget';
import { useLanguage } from '../context/LanguageContext';

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

interface HomeProps {
  onNavigate?: (screen: string) => void;
}

export function Home({ onNavigate }: HomeProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const currentMonth = currentMonthKey();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const { plans } = usePlans();
  const { monthlyIncome } = useAllocations();
  const { review } = useMonthlyReview(selectedMonth);
  const month = selectedMonth;

  const totalPlans    = plans.length;
  const completedPlans = plans.filter(p => p.currentAmount >= p.targetAmount).length;
  const totalSaved    = plans.reduce((s, p) => s + p.currentAmount, 0);

  const isOverBudget    = review && review.totalActual > review.totalBudgeted;
  const overBudgetCount = review?.review.filter(r => r.diff > 0.5).length ?? 0;
  const budgetDiff      = review ? Math.abs(review.totalActual - review.totalBudgeted) : 0;
  const budgetUsedPct   = review && review.totalBudgeted > 0
    ? Math.round((review.totalActual / review.totalBudgeted) * 100)
    : 0;

  return (
    <div className="space-y-6 pb-8">

      {/* ── Hero header ── */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl p-8 relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
        <div className="relative z-10">
          <p className="text-sm opacity-75 mb-1">
            {selectedMonth === currentMonth ? greeting(t) : t('home.reviewingPastMonth')}
          </p>
          <h1 className="text-4xl font-display tracking-tight mb-1">{monthLabel(month, language)}</h1>
          <p className="opacity-75 text-sm">
            {selectedMonth === currentMonth ? t('home.hereBudgetDoing') : t('home.historicalSummary')}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6 pt-6 border-t border-white/20">
            <div>
              <p className="text-xs opacity-70 mb-1">{t('home.monthlyIncome')}</p>
              <p className="text-2xl font-display">€{monthlyIncome.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs opacity-70 mb-1">{t('home.spentSoFar')}</p>
              <p className="text-2xl font-display">
                €{(review?.totalActual ?? 0).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs opacity-70 mb-1">{t('home.budgetUsed')}</p>
              <p className={`text-2xl font-display ${budgetUsedPct > 100 ? 'text-red-300' : budgetUsedPct > 80 ? 'text-amber-300' : ''}`}>
                {budgetUsedPct}%
              </p>
            </div>
            <div>
              <p className="text-xs opacity-70 mb-1">{t('home.totalSaved')}</p>
              <p className="text-2xl font-display">€{totalSaved.toLocaleString()}</p>
              <p className="text-xs opacity-60">{t('home.acrossAllPlans')}</p>
            </div>
            <div>
              <p className="text-xs opacity-70 mb-1">{t('home.lifePlans')}</p>
              <p className="text-2xl font-display">{completedPlans}/{totalPlans}</p>
              <p className="text-xs opacity-60">{t('home.completed')}</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Budget status banner ── */}
      {review && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          {isOverBudget ? (
            <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-2xl px-5 py-4">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-700 dark:text-red-400">
                  {t('home.overBudgetBy', { amount: budgetDiff.toLocaleString() })}
                </p>
                <p className="text-sm text-red-600/70 dark:text-red-400/70 mt-0.5">
                  {t('home.categoriesExceeded', { count: overBudgetCount })}
                </p>
              </div>
              {onNavigate && selectedMonth === currentMonth && (
                <button
                  onClick={() => onNavigate('activity')}
                  className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 hover:underline shrink-0"
                >
                  {t('home.viewExpenses')} <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          ) : review.totalActual > 0 ? (
            <div className="flex items-start gap-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-5 py-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  {selectedMonth === currentMonth
                    ? t('home.onTrack', { amount: budgetDiff.toLocaleString() })
                    : t('home.finishedUnder', { amount: budgetDiff.toLocaleString() })}
                </p>
                <p className="text-sm text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                  {t('home.usedPct', { pct: budgetUsedPct })}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3 bg-muted/50 border border-border rounded-2xl px-5 py-4">
              <Sparkles className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">{t('home.noExpenses')}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {selectedMonth === currentMonth ? t('home.startTracking') : t('home.noExpenseDataPeriod')}
                </p>
              </div>
              {onNavigate && selectedMonth === currentMonth && (
                <button
                  onClick={() => onNavigate('activity')}
                  className="text-xs text-primary flex items-center gap-1 hover:underline shrink-0"
                >
                  {t('home.addExpense')} <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}

      {/* ── Monthly Review ── */}
      <MonthlyReview
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
      />

      {/* ── Financial Tips ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-gradient-to-br from-secondary/5 via-primary/5 to-accent/5 border border-primary/10 rounded-2xl p-6 md:p-8"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center text-white">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-display">{t('home.financialTips')}</h2>
            <p className="text-sm text-muted-foreground">{t('home.principlesOptimize')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              badge: t('home.tip5030Badge'),
              badgeColor: 'bg-primary/10 text-primary',
              title: t('home.tip5030Title'),
              desc: t('home.tip5030Body'),
            },
            {
              badge: t('home.tipAutomateBadge'),
              badgeColor: 'bg-secondary/10 text-secondary',
              title: t('home.tipAutomateTitle'),
              desc: t('home.tipAutomateBody'),
            },
            {
              badge: t('home.tipReviewBadge'),
              badgeColor: 'bg-accent/10 text-accent',
              title: t('home.tipReviewTitle'),
              desc: t('home.tipReviewBody'),
            },
          ].map((rec, index) => (
            <motion.div
              key={rec.title}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 + index * 0.08 }}
              className="bg-card border border-border rounded-xl p-5"
            >
              <div className={`inline-flex px-3 py-1 rounded-full text-xs mb-3 ${rec.badgeColor}`}>
                {rec.badge}
              </div>
              <h4 className="font-display mb-2">{rec.title}</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{rec.desc}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
