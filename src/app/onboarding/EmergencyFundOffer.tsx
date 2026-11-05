import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Loader2, ShieldCheck } from 'lucide-react';
import { usePlans } from '../hooks/usePlans';
import { useMoney } from './useMoney';

interface EmergencyFundOfferProps {
  /** Euros, as the API returns them. */
  suggested: number;
  monthlyExpenses: number;
  savedSoFar: number;
  hasEmergencyPlan: boolean;
}

// Always offered after the onboarding (LPBETA-07), also to people who already
// have savings: the app can't tell whether that money really is a fund for
// emergencies. Target suggested at 3 months of the budgeted expenses, editable;
// what's already saved is proposed as the starting amount, with the advice to
// keep it apart (general guidance, no bank or product named — LPBETA-06).
export function EmergencyFundOffer({ suggested, monthlyExpenses, savedSoFar, hasEmergencyPlan }: EmergencyFundOfferProps) {
  const { t } = useTranslation();
  const { fmt, currency } = useMoney();
  const { createPlan } = usePlans();
  const [target, setTarget] = useState(suggested > 0 ? String(suggested) : '');
  const [start, setStart] = useState(savedSoFar > 0 ? String(savedSoFar) : '');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(hasEmergencyPlan);

  const handleCreate = async () => {
    const targetAmount = parseFloat(target) || 0;
    if (targetAmount <= 0) { toast.error(t('onboarding.result.emergency.targetRequired')); return; }
    setSaving(true);
    const result = await createPlan({
      title: t('onboarding.result.emergency.planTitle'),
      goalClass: 'savings',
      type: 'emergency',
      icon: '🛡️',
      color: '#10B981', // the emergency type's colour in CreatePlan
      targetAmount,
      currentAmount: Math.max(0, parseFloat(start) || 0),
    });
    setSaving(false);
    if ('error' in result) { toast.error(t('onboarding.result.emergency.createFailed')); return; }
    toast.success(t('onboarding.result.emergency.created'));
    setCreated(true);
  };

  const input = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="space-y-1 flex-1 min-w-36">
      <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="0"
          className="w-full pl-8 pr-4 py-3 border border-line-strong rounded-xl bg-background outline-none focus:border-primary text-sm tabular-nums"
        />
      </div>
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-3xl p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-pool-soft text-pool flex items-center justify-center shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <p className="text-lg font-semibold">{t('onboarding.result.emergency.title')}</p>
          <p className="text-sm text-muted-foreground">{t('onboarding.result.emergency.desc', { monthly: fmt(monthlyExpenses) })}</p>
        </div>
      </div>

      {created ? (
        <div className="bg-reed-soft text-reed rounded-2xl p-4 flex items-center gap-2 text-sm">
          <Check className="w-4 h-4 shrink-0" />
          {t(hasEmergencyPlan ? 'onboarding.result.emergency.already' : 'onboarding.result.emergency.created')}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            {input('ef-target', t('onboarding.result.emergency.targetLabel'), target, setTarget)}
            {input('ef-start', t('onboarding.result.emergency.startLabel'), start, setStart)}
          </div>
          <p className="text-xs text-muted-foreground">
            {savedSoFar > 0
              ? t('onboarding.result.emergency.savedHint', { amount: fmt(savedSoFar) })
              : t('onboarding.result.emergency.separateHint')}
          </p>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('onboarding.result.emergency.create')}
          </button>
        </>
      )}
    </div>
  );
}
