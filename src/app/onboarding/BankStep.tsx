import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { useAccounts } from '../hooks/useAccounts';
import { useMoney } from './useMoney';

// Name the server gives the checking account it seeds for every user
// (DEFAULT_ACCOUNT_NAME in server/lib/onboarding.ts). Shown as an empty field,
// so the user names their real bank.
const SEEDED_ACCOUNT_NAME = 'Main account';

// The main bank account: where income lands and card payments come from.
// Every user already has the seeded checking account, so this step fills that
// one in (name + balance) instead of adding a second one. Saved on blur.
export function BankStep() {
  const { t } = useTranslation();
  const { currency } = useMoney();
  const { accounts, createAccount, updateAccount } = useAccounts();

  const checking = accounts.find(a => a.type === 'checking' && !a.isArchived);

  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');

  useEffect(() => {
    if (!checking) return;
    setName(checking.name === SEEDED_ACCOUNT_NAME ? '' : checking.name);
    setBalance(checking.currentBalance ? String(checking.currentBalance) : '');
  }, [checking?.id]);

  const persist = async () => {
    if (!name.trim() && balance === '') return; // nothing entered yet
    const payload = {
      name: name.trim() || t('onboarding.bank.defaultName'),
      currentBalance: parseFloat(balance) || 0,
    };
    if (checking && checking.name === payload.name && checking.currentBalance === payload.currentBalance) return;
    const result = checking
      ? await updateAccount(checking.id, payload)
      : await createAccount({ ...payload, type: 'checking' });
    if ('error' in result) toast.error(result.error as string);
  };

  return (
    <div className="bg-card p-8 sm:p-10 rounded-2xl shadow-xl border border-border">
      <div className="space-y-8">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Landmark className="w-4 h-4 text-secondary" /> {t('onboarding.bank.nameLabel')}
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={persist}
            placeholder={t('onboarding.bank.namePlaceholder')}
            className="block w-full px-4 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary text-sm"
          />
        </div>

        <div className="space-y-2 pt-4 border-t border-border">
          <label className="block text-sm font-medium">{t('onboarding.bank.balanceLabel')}</label>
          <p className="text-xs text-muted-foreground mb-2">{t('onboarding.bank.balanceHint')}</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">{currency}</span>
            <input
              type="number"
              inputMode="decimal"
              value={balance}
              onChange={e => setBalance(e.target.value)}
              onBlur={persist}
              placeholder="0"
              className="block w-full pl-8 pr-4 py-4 text-xl font-display border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary transition-colors"
            />
          </div>
        </div>

        <div className="flex p-4 text-sm rounded-xl bg-muted/40 border border-border">
          <Lightbulb className="w-4 h-4 mt-0.5 mr-3 text-amber-500 shrink-0" />
          <div className="text-muted-foreground">{t('onboarding.bank.note')}</div>
        </div>
      </div>
    </div>
  );
}
