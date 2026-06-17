import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Loader2, Scale } from 'lucide-react';

interface Balance { userId: string; name: string | null; paid: number; owed: number; balance: number; }
interface Settlement { fromUserId: string; toUserId: string; fromName: string | null; toName: string | null; amount: number; }
interface Contribution { userId: string; name: string | null; income: number; sharePct: number; }

// Household balances + income contribution (Epic H4). Read-only: shows each
// member's income share and the suggested "who owes whom" from shared expenses.
export function HouseholdBalances() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [hasShared, setHasShared] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/households/balances', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/api/households/contributions', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([bal, con]) => {
      if (!active) return;
      setSettlements(bal?.settlements ?? []);
      setHasShared((bal?.balances ?? []).some((b: Balance) => b.paid > 0 || b.owed > 0));
      setContributions(con?.contributions ?? []);
      setLoading(false);
    }).catch(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) {
    return <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Income contribution */}
      {contributions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('household.contributions')}</p>
          {contributions.map(c => (
            <div key={c.userId} className="flex items-center justify-between text-sm">
              <span className="truncate">{c.name ?? '—'}</span>
              <span className="text-muted-foreground">{t('household.incomeShare', { pct: c.sharePct })}</span>
            </div>
          ))}
        </div>
      )}

      {/* Balances / who owes whom */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5" /> {t('household.balances')}
        </p>
        {settlements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasShared ? t('household.settledUp') : t('household.noShared')}
          </p>
        ) : (
          settlements.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <span className="font-medium">{s.fromName ?? '—'}</span>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium">{s.toName ?? '—'}</span>
              <span className="ml-auto font-display">€{s.amount.toLocaleString()}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
