import { useTranslation } from 'react-i18next';
import { ArrowRight, CheckCircle2, Eye, CircleDashed, type LucideIcon } from 'lucide-react';
import type { MonthLight, MonthLightResult } from '../../../shared/incomeShare';
import { useMoney } from '../onboarding/useMoney';

// Each light: its colours, an icon and a word — never colour alone. Going
// over is sun ("te has pasado"), not red: it's a watch state, not an error.
const STYLE: Record<MonthLight, { box: string; dot: string; Icon: LucideIcon }> = {
  good:    { box: 'bg-reed-soft text-reed',      dot: 'bg-reed',    Icon: CheckCircle2 },
  tight:   { box: 'bg-sun-soft text-sun-ink',    dot: 'bg-sun',     Icon: Eye },
  over:    { box: 'bg-sun-soft text-sun-ink',    dot: 'bg-sun-ink', Icon: Eye },
  neutral: { box: 'bg-muted text-foreground',    dot: 'bg-muted-foreground/50', Icon: CircleDashed },
};

const ORDER: MonthLight[] = ['good', 'tight', 'over'];

interface MonthLightCardProps {
  result: MonthLightResult;
  /** Budget lines over their budget, said under the sentence when over. */
  overBudgetCount: number;
  action?: { label: string; onClick: () => void };
}

// Home's traffic light (LPBETA-07): one word and one sentence on the month.
// The decision lives in shared/incomeShare.ts (monthLight).
export function MonthLightCard({ result, overBudgetCount, action }: MonthLightCardProps) {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { box, Icon } = STYLE[result.light];

  return (
    <div className={`${box} rounded-2xl px-5 py-4 flex items-start gap-3`} role="status">
      <Icon className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="sr-only">{t('home.light.label')}</p>
        <div className="flex items-center gap-2">
          <p className="font-semibold">{t(`home.light.word.${result.light}`)}</p>
          {/* The three lights, the current one lit. */}
          <span className="flex items-center gap-1" aria-hidden="true">
            {ORDER.map(l => (
              <span key={l} className={`w-2 h-2 rounded-full ${l === result.light ? STYLE[l].dot : 'bg-current opacity-20'}`} />
            ))}
          </span>
        </div>
        <p className="text-sm mt-0.5">{t(`home.light.${result.reason}`, { amount: fmt(result.amountCents / 100) })}</p>
        {overBudgetCount > 0 && (
          <p className="text-sm opacity-80 mt-0.5">{t('home.light.categoriesExceeded', { count: overBudgetCount })}</p>
        )}
      </div>
      {action && (
        <button onClick={action.onClick} className="text-xs flex items-center gap-1 hover:underline shrink-0">
          {action.label} <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
