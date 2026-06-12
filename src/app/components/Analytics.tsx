import { motion } from 'motion/react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { TrendingUp, BarChart3, PiggyBank } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMonth, monthKeyOffset } from '../context/MonthContext';
import { useLanguage } from '../context/LanguageContext';
import { useAnalytics } from '../hooks/useAnalytics';

const WINDOW_MONTHS = 6; // selected month + 5 preceding

function shortMonthLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale === 'es' ? 'es-ES' : 'en-GB', { month: 'short' });
}

const tooltipStyle = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
};

export function Analytics() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { selectedMonth } = useMonth();

  const from = monthKeyOffset(selectedMonth, -(WINDOW_MONTHS - 1));
  const { analytics, loading } = useAnalytics(from, selectedMonth);

  const fmtMonth = (key: string) => shortMonthLabel(key, language);
  const fmtEuro = (v: number) => `€${Math.round(v).toLocaleString()}`;

  const hasSpending = !!analytics && analytics.months.some(m => m.total > 0);
  const hasIncome = !!analytics && analytics.months.some(m => (m.income ?? 0) > 0);
  const hasSavings = !!analytics && analytics.savings.some(s => s.cumulative > 0);
  const hasCategories = !!analytics && analytics.byCategory.length > 0;

  const spendingData = analytics?.months.map(m => ({ ...m, label: fmtMonth(m.month) })) ?? [];
  const savingsData = analytics?.savings.map(s => ({ ...s, label: fmtMonth(s.month) })) ?? [];

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6 h-64 animate-pulse" />
    );
  }

  if (!analytics || (!hasSpending && !hasIncome && !hasSavings && !hasCategories)) {
    return (
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="text-center py-10 space-y-3">
          <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto">
            <BarChart3 className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="font-display text-lg">{t('analytics.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('analytics.emptyDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
      className="space-y-6"
    >
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center text-white">
          <TrendingUp className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-2xl font-display">{t('analytics.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('analytics.subtitle', { count: WINDOW_MONTHS })}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Month-over-month spending ── */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-display text-lg">{t('analytics.cashflow')}</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={spendingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={fmtEuro} width={56} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(v: number, name: string) => [fmtEuro(v), name === 'income' ? t('analytics.income') : t('analytics.spent')]}
                />
                <Legend formatter={(name) => name === 'income' ? t('analytics.income') : t('analytics.spent')} />
                <Bar dataKey="income" fill="var(--secondary)" radius={[8, 8, 0, 0]} />
                <Bar dataKey="total" fill="var(--primary)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Savings trend ── */}
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <PiggyBank className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-display text-lg">{t('analytics.savingsTrend')}</h3>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={savingsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={fmtEuro} width={56} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmtEuro(v), t('analytics.saved')]} />
                <Line type="monotone" dataKey="cumulative" stroke="var(--secondary)" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Average spend per category ── */}
      {hasCategories && (
        <div className="bg-card border border-border rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-display text-lg">{t('analytics.avgByCategory')}</h3>
          </div>
          <div className="space-y-3">
            {(() => {
              const max = Math.max(...analytics.byCategory.map(c => c.avg), 1);
              return analytics.byCategory.map((c, i) => (
                <motion.div
                  key={c.allocationId}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 * i }}
                  className="flex items-center gap-3"
                >
                  <span className="text-lg shrink-0">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm truncate">{c.name}</span>
                      <span className="text-sm font-display shrink-0 ml-2">{fmtEuro(c.avg)}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }} animate={{ width: `${(c.avg / max) * 100}%` }}
                        transition={{ delay: 0.05 * i + 0.1, duration: 0.4 }}
                        className="h-full bg-gradient-to-r from-primary to-secondary rounded-full"
                      />
                    </div>
                  </div>
                </motion.div>
              ));
            })()}
          </div>
          <p className="text-xs text-muted-foreground mt-4">{t('analytics.avgHint', { count: WINDOW_MONTHS })}</p>
        </div>
      )}
    </motion.div>
  );
}
