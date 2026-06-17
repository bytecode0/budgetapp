import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Loader2, TrendingUp, TrendingDown, PiggyBank, Landmark, Users } from 'lucide-react';
import { useMonth } from '../context/MonthContext';

interface Health { income: number; expenses: number; savings: number; savingsRate: number; netWorth: number; }
interface Person { userId: string; name: string | null; income: number; spent: number; contributionPct: number; }
interface Category { allocationId: string | null; name: string | null; icon: string; total: number; }
interface DashboardData { health: Health; byPerson: Person[]; byCategory: Category[]; }

// Family dashboard (Epic H8). Household-level health, per-person breakdown and
// per-category spend for the selected month. Aggregates only — no transaction
// detail — so it's safe at the shared_stats privacy tier.
export function FamilyDashboard() {
  const { t } = useTranslation();
  const { selectedMonth } = useMonth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/dashboard/household?period=${selectedMonth}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active) { setData(d); setLoading(false); } })
      .catch(() => active && setLoading(false));
    return () => { active = false; };
  }, [selectedMonth]);

  const eur = (n: number) => `€${n.toLocaleString()}`;

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!data) {
    return <div className="text-center py-20 text-muted-foreground">{t('familyDashboard.noData')}</div>;
  }

  const { health, byPerson, byCategory } = data;
  const maxCat = Math.max(1, ...byCategory.map(c => c.total));

  const stats = [
    { label: t('familyDashboard.income'), value: eur(health.income), icon: TrendingUp, tone: 'text-emerald-600' },
    { label: t('familyDashboard.expenses'), value: eur(health.expenses), icon: TrendingDown, tone: 'text-red-500' },
    { label: t('familyDashboard.savings'), value: eur(health.savings), icon: PiggyBank, tone: health.savings >= 0 ? 'text-emerald-600' : 'text-red-500' },
    { label: t('familyDashboard.netWorth'), value: eur(health.netWorth), icon: Landmark, tone: '' },
  ];

  return (
    <div className="space-y-6 pb-8">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-1">
        <h1 className="text-4xl tracking-tight flex items-center gap-2"><Users className="w-7 h-7 text-primary" /> {t('familyDashboard.title')}</h1>
        <p className="text-muted-foreground">{t('familyDashboard.subtitle')}</p>
      </motion.div>

      {/* Financial health */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <s.icon className="w-4 h-4" /><span className="text-xs">{s.label}</span>
            </div>
            <p className={`text-2xl font-display ${s.tone}`}>{s.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Savings rate */}
      <div className="bg-gradient-to-br from-primary/5 to-secondary/5 border border-primary/10 rounded-2xl p-5 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{t('familyDashboard.savingsRate')}</span>
        <span className={`text-2xl font-display ${health.savingsRate >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{health.savingsRate}%</span>
      </div>

      {/* By person */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="font-display text-lg">{t('familyDashboard.byPerson')}</h2>
        <div className="space-y-3">
          {byPerson.map(p => (
            <div key={p.userId} className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium shrink-0">
                {(p.name ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{p.name ?? '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {t('familyDashboard.personLine', { income: p.income.toLocaleString(), spent: p.spent.toLocaleString() })}
                </p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                {t('familyDashboard.contribution', { pct: p.contributionPct })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* By category */}
      <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
        <h2 className="font-display text-lg">{t('familyDashboard.byCategory')}</h2>
        {byCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('familyDashboard.noSpending')}</p>
        ) : (
          <div className="space-y-3">
            {byCategory.map((c, i) => (
              <div key={c.allocationId ?? `un-${i}`} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 truncate">
                    <span>{c.icon}</span>{c.name ?? t('familyDashboard.unassigned')}
                  </span>
                  <span className="font-display">{eur(c.total)}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
