import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PiggyBank, TrendingUp, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { useAccounts } from '../hooks/useAccounts';

const CASH_ACCOUNT_NAME = 'Ahorros';
const INVESTMENT_ACCOUNT_NAME = 'Inversiones';

// Deliberate simplification vs. the earlier (list-of-named-categories) design:
// this screen asks for two single totals — how much is already saved and how
// much is already invested today — which is exactly what the Método Ruta
// needs at this point (R5.2 colchón progress, Estado A/B), not a name-per-item
// breakdown. Each total is backed by a single upserted Account.
export function SavingsStep() {
  const { t } = useTranslation();
  const { accounts, createAccount, updateAccount } = useAccounts();

  const cashAccount = accounts.find(a => a.type === 'cash' || a.type === 'savings');
  const investmentAccount = accounts.find(a => a.type === 'investment');

  const [cash, setCash] = useState('');
  const [investment, setInvestment] = useState('');

  useEffect(() => { if (cashAccount) setCash(String(cashAccount.currentBalance || '')); }, [cashAccount?.id]);
  useEffect(() => { if (investmentAccount) setInvestment(String(investmentAccount.currentBalance || '')); }, [investmentAccount?.id]);

  const persist = async (
    existing: typeof cashAccount,
    name: string,
    type: 'cash' | 'investment',
    value: string,
  ) => {
    const amount = parseFloat(value) || 0;
    const result = existing
      ? await updateAccount(existing.id, { currentBalance: amount })
      : await createAccount({ name, type, currentBalance: amount });
    if ('error' in result) toast.error(result.error as string);
  };

  return (
    <div className="bg-card p-8 sm:p-10 rounded-2xl shadow-xl border border-border">
      <div className="space-y-8">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <PiggyBank className="w-4 h-4 text-secondary" /> {t('onboarding.savings.cashTitle')}
          </label>
          <p className="text-xs text-muted-foreground mb-2">{t('onboarding.savings.cashDesc')}</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">€</span>
            <input
              type="number"
              inputMode="decimal"
              value={cash}
              onChange={e => setCash(e.target.value)}
              onBlur={() => persist(cashAccount, CASH_ACCOUNT_NAME, 'cash', cash)}
              placeholder="0.00"
              className="block w-full pl-8 pr-4 py-4 text-xl font-display border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary transition-colors"
            />
          </div>
        </div>

        <div className="space-y-2 pt-4 border-t border-border">
          <label className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="w-4 h-4 text-secondary" /> {t('onboarding.savings.investmentTitle')}
          </label>
          <p className="text-xs text-muted-foreground mb-2">{t('onboarding.savings.investmentDesc')}</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">€</span>
            <input
              type="number"
              inputMode="decimal"
              value={investment}
              onChange={e => setInvestment(e.target.value)}
              onBlur={() => persist(investmentAccount, INVESTMENT_ACCOUNT_NAME, 'investment', investment)}
              placeholder="0.00"
              className="block w-full pl-8 pr-4 py-4 text-xl font-display border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary transition-colors"
            />
          </div>
        </div>

        <div className="flex p-4 text-sm rounded-xl bg-muted/40 border border-border">
          <Lightbulb className="w-4 h-4 mt-0.5 mr-3 text-amber-500 shrink-0" />
          <div className="text-muted-foreground">{t('onboarding.savings.excludeNote')}</div>
        </div>
      </div>
    </div>
  );
}
