import { useTranslation } from 'react-i18next';
import type { DebtCycle } from '../../hooks/useDebts';

// A card's billing cycle under its row in Debts: what the next due date asks
// for ("lo que vence") and the purchases after the cut-off, due the month
// after. The row's big number stays the total balance.
export function CardCycleLine({ cycle, fmt, locale }: { cycle: DebtCycle; fmt: (euros: number) => string; locale: string }) {
  const { t } = useTranslation();
  // The API sends UTC days; format them as such so no timezone shifts the day.
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="text-xs text-muted-foreground">
      <p>
        {t(cycle.closed ? 'debts.cycle.due' : 'debts.cycle.dueOpen', {
          amount: fmt(cycle.dueAmount), date: day(cycle.dueOn), closes: day(cycle.closesOn),
        })}
      </p>
      {cycle.afterCutAmount > 0 && (
        <p>{t('debts.cycle.afterCut', { amount: fmt(cycle.afterCutAmount), date: day(cycle.afterCutDueOn) })}</p>
      )}
    </div>
  );
}
