import { useTranslation } from 'react-i18next';

// The four screens a person actually walks through: upload → review → context
// → email. The result screen is the reward, not a fifth step, so it renders
// the bar full (`done`) with no time estimate.
//
// The remaining-time estimate lives here rather than in a prop so it can only
// ever go down. Passing it per screen is how it drifted before — 5 min on step
// 1, 3 min on step 2, nothing at all on the last two.
//
// Skipping the statement upload skips step 2 entirely, so the bar jumps 1 → 3.
// That is honest: those people really do have one screen less to cross.
const TOTAL_STEPS = 4;
const MINUTES_LEFT: Record<number, number> = { 1: 4, 2: 3, 3: 2, 4: 1 };

export function OnboardingProgress({ step }: { step: number | 'done' }) {
  const { t } = useTranslation();
  const done = step === 'done';
  const current = done ? TOTAL_STEPS : step;
  const label = done
    ? t('radiografia.onboarding.progress.done')
    : t('radiografia.onboarding.progress.label', { step: current, total: TOTAL_STEPS });

  return (
    <div className="w-full max-w-xl mx-auto space-y-2" aria-label={label}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {!done && <span>{t('radiografia.onboarding.progress.time', { minutes: MINUTES_LEFT[current] ?? 1 })}</span>}
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {Array.from({ length: TOTAL_STEPS }, (_, index) => (
          <span
            key={index}
            className="h-2 flex-1 rounded-full transition-colors"
            style={{ background: index < current ? 'var(--primary)' : 'var(--xray-track)' }}
          />
        ))}
      </div>
    </div>
  );
}
