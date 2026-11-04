import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { HandHeart, Loader2 } from 'lucide-react';
import { useAllocations } from '../hooks/useAllocations';
import { setGenerosityPct } from '../hooks/useOnboardingNeeded';
import { pctToBps } from '../../../shared/incomeShare';
import { PercentPicker } from './PercentPicker';
import { useMoney } from './useMoney';

// Examples only, none marked as the right one.
const EXAMPLES = [2, 5, 10];

// "¿Quieres reservar una parte para dar?" (LPBETA-10): a free, optional share
// of the HOUSEHOLD's income for the Generosity line, the first line of the
// budget. "Ahora no" is 0 %; the line stays and can be changed any time.
// Shown as "Das X al mes", with no judgement at 0.
export function GenerosityStep() {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { allocations, monthlyIncome, generosityBps, loading } = useAllocations();
  const [bps, setBps] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | null>(null); // euros, from the server once saved
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loading) setBps(generosityBps); }, [loading, generosityBps]);

  const save = async (pct: number) => {
    const previous = bps;
    setBps(pctToBps(pct));
    setSaving(true);
    const result = await setGenerosityPct(pct);
    setSaving(false);
    if (result.error) { setBps(previous); toast.error(t('onboarding.generosity.saveFailed')); return; }
    setAmount(typeof result.data?.generosityAmount === 'number' ? result.data.generosityAmount : null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // The server's figure (the share of this period's household income, as
  // Home counts it): the line as read, then what each save answers.
  const line = allocations.find(a => a.type === 'generosity');
  const shown = amount ?? (bps !== null && line ? line.allocatedAmount : null);

  return (
    <div className="bg-card border border-border rounded-3xl p-6 sm:p-8 space-y-6">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-sun-soft text-sun-ink flex items-center justify-center shrink-0">
          <HandHeart className="w-5 h-5" />
        </div>
        <p className="text-sm text-muted-foreground">{t('onboarding.generosity.desc')}</p>
      </div>

      <PercentPicker
        valueBps={bps}
        examples={EXAMPLES}
        onChange={save}
        zeroLabel={t('onboarding.generosity.notNow')}
        disabled={saving}
      />

      {shown !== null && (
        <p className="text-sm tabular-nums" aria-live="polite">
          {shown > 0
            ? t('onboarding.generosity.gives', { amount: fmt(shown) })
            : t('onboarding.generosity.givesNothing')}
        </p>
      )}
      {bps !== null && bps > 0 && monthlyIncome <= 0 && (
        <p className="text-xs text-muted-foreground">{t('onboarding.generosity.noIncome')}</p>
      )}
    </div>
  );
}
