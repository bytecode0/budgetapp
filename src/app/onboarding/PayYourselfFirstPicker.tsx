import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { setPayYourselfFirstPct } from '../hooks/useOnboardingNeeded';
import { bpsToPct, pctToBps, shareOfIncome } from '../../../shared/incomeShare';
import { toCents } from '../../../shared/budgetStatus';
import { PercentPicker } from './PercentPicker';
import { useMoney } from './useMoney';

// Examples only: none is "the right one" — each user picks their own share.
const EXAMPLES = [10, 15, 20];

interface PayYourselfFirstPickerProps {
  valueBps: number | null;
  /** The household's monthly income, in euros. */
  income: number;
  /** What the budget leaves free, in euros; when given and the share needs more, say so. */
  leftover?: number;
  onSaved: (bps: number) => void;
}

// "Págate a ti primero" (LPBETA-07): the % the user sets aside on payday.
// Saved on every pick (PATCH /api/onboarding/preferences).
export function PayYourselfFirstPicker({ valueBps, income, leftover, onSaved }: PayYourselfFirstPickerProps) {
  const { t } = useTranslation();
  const { fmt, locale } = useMoney();
  const [saving, setSaving] = useState(false);

  const save = async (pct: number) => {
    const bps = pctToBps(pct);
    if (bps === null) return;
    setSaving(true);
    const result = await setPayYourselfFirstPct(pct);
    setSaving(false);
    if (result.error) { toast.error(t('onboarding.result.payFirst.saveFailed')); return; }
    onSaved(bps);
  };

  const goalCents = valueBps !== null ? shareOfIncome(toCents(income), valueBps) : 0;
  const leftoverCents = leftover !== undefined ? toCents(leftover) : null;

  return (
    <div className="space-y-3">
      <PercentPicker valueBps={valueBps} examples={EXAMPLES} onChange={save} disabled={saving} />
      {valueBps !== null && income > 0 && (
        <p className="text-sm tabular-nums">
          {t('onboarding.result.payFirst.amount', { pct: bpsToPct(valueBps).toLocaleString(locale), amount: fmt(goalCents / 100) })}
        </p>
      )}
      {valueBps !== null && leftoverCents !== null && goalCents > Math.max(0, leftoverCents) && (
        <p className="text-xs text-muted-foreground">
          {t('onboarding.result.payFirst.noRoom', { leftover: fmt(Math.max(0, leftoverCents) / 100) })}
        </p>
      )}
    </div>
  );
}
