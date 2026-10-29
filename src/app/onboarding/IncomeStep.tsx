import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Loader2, ShieldCheck, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import { useIncome } from '../hooks/useIncome';
import { useAllocations } from '../hooks/useAllocations';
import { usePartner } from '../hooks/usePartner';
import { useAuth } from '../context/AuthContext';
import { useMoney } from './useMoney';

const PAYDAYS = Array.from({ length: 28 }, (_, i) => i + 1); // 1-28, as UserSettings.cycleStartDay

// Método Ruta note: this step only captures the user's OWN income. A partner's
// income belongs to their own account — inviting them (reusing the existing
// PartnerInvite flow) is the correct way to bring it in, not a manually typed
// number here that would drift from a real household member.
export function IncomeStep() {
  const { t } = useTranslation();
  const { fmt, currency } = useMoney();
  const { user } = useAuth();
  const { incomes: poolIncomes, createIncome, deleteIncome } = useIncome();
  const { updateIncome, cycleStartDay, updatePayday } = useAllocations();
  const { status, sendInvite } = usePartner();

  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [householdOn, setHouseholdOn] = useState(false);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [invitingPartner, setInvitingPartner] = useState(false);

  // In a couple the pool holds both partners' income; this step is only
  // about the signed-in person's own.
  const incomes = poolIncomes.filter(i => i.ownerUserId === user?.id);
  const ownIncome = incomes.reduce((s, i) => s + i.amount, 0);

  // Keep the person's own UserSettings.monthlyIncome (the baseline the rest of
  // the app reads, summed across the household, when there's no Income history
  // yet) in sync as income rows change — header nav has no per-step submit
  // step to hang this off of. Own income only, so a partner's never counts twice.
  const syncedRef = useRef<number | null>(null);
  useEffect(() => {
    if (ownIncome === syncedRef.current) return;
    syncedRef.current = ownIncome;
    if (ownIncome > 0) updateIncome(ownIncome);
  }, [ownIncome]);

  const handleAdd = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) return;
    setSaving(true);
    const result = await createIncome({ amount: value, category: 'salary' });
    setSaving(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    setAmount('');
  };

  const handlePayday = async (day: number) => {
    const result = await updatePayday(day);
    if (result.error) toast.error(result.error);
  };

  const handleInvitePartner = async () => {
    if (!partnerEmail.trim()) return;
    setInvitingPartner(true);
    const result = await sendInvite(partnerEmail.trim());
    setInvitingPartner(false);
    if ('error' in result && result.error) { toast.error(result.error); return; }
    toast.success(t('onboarding.income.inviteSent'));
  };

  const hasPartnerLink = status?.state === 'invite_pending' || status?.state === 'linked_primary' || status?.state === 'linked_secondary';

  return (
    <div className="bg-card p-8 sm:p-10 rounded-2xl shadow-xl border border-border">
      <div className="space-y-8">
        {/* Household toggle */}
        <div className="flex items-center justify-between p-4 bg-secondary/5 border border-secondary/10 rounded-xl">
          <div>
            <h3 className="text-sm font-semibold">{t('onboarding.income.householdTitle')}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t('onboarding.income.householdDesc')}</p>
          </div>
          <button
            role="switch"
            aria-checked={householdOn}
            onClick={() => setHouseholdOn(v => !v)}
            disabled={hasPartnerLink}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ml-4 disabled:opacity-60 ${householdOn || hasPartnerLink ? 'bg-secondary' : 'bg-muted'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${householdOn || hasPartnerLink ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {/* Primary income */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">{t('onboarding.income.primaryLabel')}</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">{currency}</span>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="0"
              className="block w-full pl-8 pr-4 py-4 text-xl font-display border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary transition-colors"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t('onboarding.income.afterTax')}</p>
        </div>

        {incomes.length > 0 && (
          <div className="space-y-2">
            {incomes.map(i => (
              <div key={i.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/30">
                <span className="text-sm font-medium">{i.description || t('onboarding.income.defaultLabel')}</span>
                <div className="flex items-center gap-3">
                  <span className="font-display">{fmt(i.amount)}</span>
                  <button onClick={() => deleteIncome(i.id)} className="text-muted-foreground hover:text-destructive">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={saving || !amount}
          className="text-sm font-semibold text-secondary hover:text-secondary/80 flex items-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {t('onboarding.income.addAnother')}
        </button>

        {/* Payday — the day the budget period starts (UserSettings.cycleStartDay) */}
        <div className="space-y-2 pt-4 border-t border-border">
          <label className="flex items-center gap-2 text-sm font-medium">
            <CalendarDays className="w-4 h-4 text-secondary" /> {t('onboarding.income.paydayLabel')}
          </label>
          <select
            value={cycleStartDay}
            onChange={e => handlePayday(parseInt(e.target.value, 10))}
            className="block w-full px-4 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary text-sm"
          >
            {PAYDAYS.map(d => <option key={d} value={d}>{t('onboarding.income.paydayOption', { day: d })}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">{t('onboarding.income.paydayHint')}</p>
        </div>

        {/* Household / partner income */}
        {householdOn && (
          <div className="space-y-2 pt-2 border-t border-border">
            <label className="block text-sm font-medium">{t('onboarding.income.partnerLabel')}</label>
            {hasPartnerLink ? (
              <p className="text-xs text-muted-foreground">
                {status?.state === 'invite_pending'
                  ? t('onboarding.income.invitePending', { email: status.pendingInvite?.email })
                  : t('onboarding.income.partnerLinked')}
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={partnerEmail}
                  onChange={e => setPartnerEmail(e.target.value)}
                  placeholder={t('onboarding.income.partnerEmailPlaceholder') as string}
                  className="flex-1 px-4 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary text-sm"
                />
                <button
                  onClick={handleInvitePartner}
                  disabled={invitingPartner || !partnerEmail.trim()}
                  className="px-5 py-3 bg-foreground text-background rounded-xl text-sm font-medium disabled:opacity-50"
                >
                  {t('onboarding.income.invite')}
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('onboarding.income.partnerHint')}</p>
          </div>
        )}

        <div className="flex p-4 text-sm rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900 text-blue-800 dark:text-blue-400">
          <ShieldCheck className="w-4 h-4 mt-0.5 mr-3 shrink-0" />
          <div>{t('onboarding.income.privacyNote')}</div>
        </div>
      </div>
    </div>
  );
}
