import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Lightbulb, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAccounts } from '../hooks/useAccounts';
import { useOnboardingNeeded } from '../hooks/useOnboardingNeeded';
import { useMoney } from './useMoney';

// The main bank account: where income lands and card payments come from.
// Every user already has a seeded checking account; while it's untouched the
// server reports it as defaultAccountId, and this step fills it in (name +
// balance) instead of adding a second one. Coming back to the step edits the
// same manual account. A bank-linked account is never picked: its name and
// balance come from the bank — then a new manual account is created.
// Saved on blur.
export function BankStep() {
  const { t } = useTranslation();
  const { currency } = useMoney();
  const { accounts, loading: accountsLoading, createAccount, updateAccount } = useAccounts();
  const { defaultAccountId, loading: statusLoading } = useOnboardingNeeded(true);

  const manualChecking = accounts.filter(a => a.type === 'checking' && !a.isArchived && !a.bankConnectionId);
  const target = manualChecking.find(a => a.id === defaultAccountId) ?? manualChecking[0];
  const ready = !accountsLoading && !statusLoading;

  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');

  useEffect(() => {
    if (!ready || !target) return;
    // The untouched default shows empty, so the user names their real bank.
    setName(target.id === defaultAccountId ? '' : target.name);
    setBalance(target.currentBalance ? String(target.currentBalance) : '');
  }, [ready, target?.id]);

  const persist = async () => {
    if (!ready) return;
    if (!name.trim() && balance === '') return; // nothing entered yet
    const payload = {
      name: name.trim() || t('onboarding.bank.defaultName'),
      currentBalance: parseFloat(balance) || 0,
    };
    if (target && target.name === payload.name && target.currentBalance === payload.currentBalance) return;
    const result = target
      ? await updateAccount(target.id, payload)
      : await createAccount({ ...payload, type: 'checking' });
    if ('error' in result) toast.error(result.error as string);
  };

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
