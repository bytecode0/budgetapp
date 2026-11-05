import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bpsToPct, pctToBps } from '../../../shared/incomeShare';
import { useMoney } from './useMoney';

interface PercentPickerProps {
  /** The stored choice in basis points (1000 = 10 %); null = none yet. */
  valueBps: number | null;
  /** Example percentages, shown as equal chips: none is marked as "the" right one. */
  examples: number[];
  /** Called with the chosen percentage (0–100). */
  onChange: (pct: number) => void;
  /** Optional chip that means 0 % ("Ahora no"). */
  zeroLabel?: string;
  disabled?: boolean;
}

const chip = (selected: boolean) =>
  `px-4 py-2 rounded-full border text-sm transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
    selected ? 'bg-pool-soft text-pool border-pool font-semibold' : 'border-line-strong hover:bg-muted'
  }`;

// The user's own percentage (LPBETA-07 "Págate a ti primero", LPBETA-10
// Generosity): a few examples plus "Otro" with a free value.
export function PercentPicker({ valueBps, examples, onChange, zeroLabel, disabled }: PercentPickerProps) {
  const { t } = useTranslation();
  const { locale } = useMoney();
  const exampleBps = examples.map(p => pctToBps(p));
  const isExample = valueBps !== null && exampleBps.includes(valueBps);
  const isZero = zeroLabel !== undefined && valueBps === 0;
  const isCustom = valueBps !== null && !isExample && !isZero;

  const [showCustom, setShowCustom] = useState(isCustom);
  const [custom, setCustom] = useState(isCustom ? bpsToPct(valueBps!).toLocaleString(locale) : '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (isCustom) { setShowCustom(true); setCustom(bpsToPct(valueBps!).toLocaleString(locale)); }
  }, [valueBps]);

  const commitCustom = () => {
    if (custom.trim() === '') return;
    const bps = pctToBps(custom);
    if (bps === null) { setInvalid(true); return; }
    setInvalid(false);
    if (bps !== valueBps) onChange(bpsToPct(bps));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {examples.map(p => {
          const selected = valueBps === pctToBps(p) && !showCustom;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => { setShowCustom(false); setInvalid(false); onChange(p); }}
              className={chip(selected)}
            >
              {t('onboarding.percent.example', { pct: p.toLocaleString(locale) })}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={showCustom}
          disabled={disabled}
          onClick={() => setShowCustom(true)}
          className={chip(showCustom)}
        >
          {t('onboarding.percent.other')}
        </button>
        {zeroLabel !== undefined && (
          <button
            type="button"
            role="radio"
            aria-checked={isZero && !showCustom}
            disabled={disabled}
            onClick={() => { setShowCustom(false); setInvalid(false); onChange(0); }}
            className={chip(isZero && !showCustom)}
          >
            {zeroLabel}
          </button>
        )}
      </div>

      {showCustom && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="percent-custom">{t('onboarding.percent.customLabel')}</label>
          <div className="relative w-36">
            <input
              id="percent-custom"
              autoFocus={!isCustom}
              type="text"
              inputMode="decimal"
              value={custom}
              disabled={disabled}
              onChange={e => { setCustom(e.target.value); setInvalid(false); }}
              onBlur={commitCustom}
              onKeyDown={e => { if (e.key === 'Enter') commitCustom(); }}
              placeholder="0"
              aria-invalid={invalid}
              className="w-full pl-4 pr-8 py-2.5 border border-line-strong rounded-xl bg-background outline-none focus:border-primary text-sm tabular-nums"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
          </div>
          {invalid && <p className="text-xs text-alert">{t('onboarding.percent.invalid')}</p>}
        </div>
      )}
    </div>
  );
}
