import { TrendingUp, TrendingDown, CheckCircle2, AlertTriangle, Loader2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useMonthlyReview } from '../hooks/useMonthlyBudget';
import { useLanguage } from '../context/LanguageContext';
import { useMonth, monthLabel } from '../context/MonthContext';

function normalizeType(type: string): string {
  if (type === 'essential') return 'fixed';
  if (type === 'investment') return 'plan';
  return type;
}

function getTypeColor(type: string) {
  switch (normalizeType(type)) {
    case 'fixed':    return '#1E3A8A';
    case 'flexible': return '#F59E0B';
    case 'plan':     return '#8B5CF6';
    default:         return '#9CA3AF';
  }
}

function getTypeBg(type: string) {
  switch (normalizeType(type)) {
    case 'fixed':    return 'bg-blue-500';
    case 'flexible': return 'bg-amber-500';
    case 'plan':     return 'bg-violet-500';
    default:         return 'bg-gray-400';
  }
}

export function MonthlyReview() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { selectedMonth, isCurrentMonth, isFutureMonth } = useMonth();
  const { review, loading } = useMonthlyReview(selectedMonth);

  return (
    <div className="space-y-6 pb-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="text-3xl font-display tracking-tight mb-1">{t('monthlyReview.title')}</h2>
        <p className="text-muted-foreground">{t('monthlyReview.subtitle')}</p>
      </motion.div>

      {/* Month label */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="flex items-center gap-3 bg-card border border-border rounded-2xl p-4"
      >
        <p className="font-display text-xl capitalize flex-1">{monthLabel(selectedMonth, locale)}</p>
        {isCurrentMonth && (
          <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t('monthlyReview.currentMonth')}</span>
        )}
        {isFutureMonth && (
          <span className="text-xs text-violet-600 bg-violet-100 dark:bg-violet-900/30 dark:text-violet-400 px-2 py-0.5 rounded-full">{t('monthlyReview.nextMonth')}</span>
        )}
      </motion.div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : !review ? (
        <div className="text-center py-16 text-muted-foreground">
          {t('monthlyReview.noData')}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={selectedMonth}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Total budgeted */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
                className="bg-card border border-border rounded-2xl p-5"
              >
                <p className="text-sm text-muted-foreground mb-2">{t('monthlyReview.totalBudgeted')}</p>
                <p className="text-3xl font-display">€{review.totalBudgeted.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">{t('monthlyReview.acrossCategories')}</p>
              </motion.div>

              {/* Total spent */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
                className={`rounded-2xl p-5 border-2 ${
                  review.totalActual > review.totalBudgeted
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                    : 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {review.totalActual > review.totalBudgeted
                    ? <TrendingUp className="w-4 h-4 text-red-500" />
                    : <TrendingDown className="w-4 h-4 text-emerald-500" />
                  }
                  <p className="text-sm text-muted-foreground">{t('monthlyReview.totalSpent')}</p>
                </div>
                <p className={`text-3xl font-display ${
                  review.totalActual > review.totalBudgeted ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                }`}>
                  €{review.totalActual.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {review.totalActual > review.totalBudgeted ? t('monthlyReview.overBudget') : t('monthlyReview.underBudget')}
                </p>
              </motion.div>

              {/* Surplus / Deficit */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                className="bg-card border border-border rounded-2xl p-5"
              >
                <p className="text-sm text-muted-foreground mb-2">
                  {review.totalActual > review.totalBudgeted ? t('monthlyReview.overBudgetBy') : t('monthlyReview.savedVsBudget')}
                </p>
                <p className={`text-3xl font-display ${
                  review.totalActual > review.totalBudgeted ? 'text-red-500' : 'text-emerald-500'
                }`}>
                  {review.totalActual > review.totalBudgeted ? '-' : '+'}€{Math.abs(review.totalActual - review.totalBudgeted).toLocaleString()}
                </p>
                {review.unassigned > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    {t('monthlyReview.unassignedAmount', { amount: review.unassigned.toLocaleString() })}
                  </p>
                )}
              </motion.div>
            </div>

            {/* Per-allocation breakdown */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
              className="bg-card border border-border rounded-2xl p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg">{t('monthlyReview.byCategory')}</h3>
                {!review.review.some(r => r.hasSavedBudget) && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-full">
                    <Info className="w-3 h-3" />
                    {t('monthlyReview.noSnapshotNote')}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {review.review.map((row, i) => {
                  const pct       = row.budgeted > 0 ? Math.min((row.actual / row.budgeted) * 100, 120) : 0;
                  const isOver    = row.diff > 0.5;
                  const isUnder   = row.diff < -0.5;
                  const color     = getTypeColor(row.type);

                  return (
                    <motion.div
                      key={row.allocationId}
                      initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 + i * 0.04 }}
                      className="space-y-2"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xl w-8 text-center shrink-0">{row.icon}</span>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{row.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${getTypeBg(row.type)}`} />
                              <span className="text-xs text-muted-foreground capitalize">{normalizeType(row.type)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4 shrink-0 text-right">
                          <div>
                            <p className="text-xs text-muted-foreground">{t('monthlyReview.budget')}</p>
                            <p className="text-sm font-medium">€{row.budgeted.toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">{t('monthlyReview.actual')}</p>
                            <p className={`text-sm font-medium ${isOver ? 'text-red-500' : isUnder ? 'text-emerald-500' : ''}`}>
                              €{row.actual.toLocaleString()}
                            </p>
                          </div>
                          <div className="w-16">
                            <p className="text-xs text-muted-foreground">{t('monthlyReview.diff')}</p>
                            <p className={`text-sm font-display ${isOver ? 'text-red-500' : isUnder ? 'text-emerald-500' : 'text-muted-foreground'}`}>
                              {isOver ? '+' : isUnder ? '-' : ''}€{Math.abs(row.diff).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar: actual vs budget */}
                      <div className="h-2 bg-muted rounded-full overflow-hidden relative">
                        {/* Budget bar (background reference) */}
                        <div className="absolute inset-0 h-full w-full rounded-full" style={{ backgroundColor: color + '20' }} />
                        {/* Actual spend bar */}
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(pct, 100)}%` }}
                          transition={{ duration: 0.8, delay: 0.3 + i * 0.04, ease: 'easeOut' }}
                          className="absolute top-0 left-0 h-full rounded-full"
                          style={{ backgroundColor: isOver ? '#EF4444' : color }}
                        />
                        {/* Over-budget overflow indicator */}
                        {isOver && (
                          <div className="absolute top-0 right-0 h-full w-1 bg-red-300 dark:bg-red-700 rounded-r-full" />
                        )}
                      </div>

                      {/* Status label */}
                      {row.actual === 0 ? (
                        <p className="text-xs text-muted-foreground">{t('monthlyReview.noExpensesRecorded')}</p>
                      ) : isOver ? (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {t('monthlyReview.overBy', { amount: row.diff.toLocaleString(), pct: (pct - 100).toFixed(0) })}
                        </p>
                      ) : isUnder ? (
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {t('monthlyReview.underBy', { amount: Math.abs(row.diff).toLocaleString(), pct: (100 - pct).toFixed(0) })}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">{t('monthlyReview.exactlyOnBudget')}</p>
                      )}
                    </motion.div>
                  );
                })}
              </div>

              {/* Unassigned spending */}
              {review.unassigned > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    {t('monthlyReview.unassignedNote', { amount: review.unassigned.toLocaleString() })}
                  </span>
                </div>
              )}
            </motion.div>

            {/* Tip for current month */}
            {isCurrentMonth && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                className="bg-primary/5 border border-primary/15 rounded-xl px-5 py-4 flex items-start gap-3 text-sm"
              >
                <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <p className="text-muted-foreground">
                  {t('monthlyReview.currentMonthNote')}
                </p>
              </motion.div>
            )}

            {/* Tip for next month planning */}
            {isFutureMonth && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
                className="bg-violet-500/5 border border-violet-500/20 rounded-xl px-5 py-4 flex items-start gap-3 text-sm"
              >
                <Info className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                <p className="text-muted-foreground">
                  {t('monthlyReview.nextMonthNote')}
                </p>
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
