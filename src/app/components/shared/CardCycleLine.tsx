import { useTranslation } from 'react-i18next';
import type { DebtCycle } from '../../hooks/useDebts';

// A card's billing cycle under its row in Debts: what the next due date asks
// for ("lo que vence"; for a card paid by its minimum, the minimum and then the
// statement) and the purchases after the cut-off, due the month after. The
// row's big number stays the total balance.
export function CardCycleLine({ cycle, fmt, locale }: { cycle: DebtCycle; fmt: (euros: number) => string; locale: string }) {
  const { t } = useTranslation();
  // The API sends UTC days; format them as such so no timezone shifts the day.
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="text-xs text-muted-foreground">
      {/* A card paid by its minimum: the minimum due, then the statement. */}
      {cycle.minimumDue != null && (
        <p>{t('debts.cycle.minimumDue', { amount: fmt(cycle.minimumDue), date: day(cycle.dueOn) })}</p>
      )}
      <p>
        {t(cycle.minimumDue != null
          ? (cycle.closed ? 'debts.cycle.statement' : 'debts.cycle.statementOpen')
          : (cycle.closed ? 'debts.cycle.due' : 'debts.cycle.dueOpen'), {
          amount: fmt(cycle.dueAmount), date: day(cycle.dueOn), closes: day(cycle.closesOn),
        })}
      </p>
      {cycle.afterCutAmount > 0 && (
        <p>{t('debts.cycle.afterCut', { amount: fmt(cycle.afterCutAmount), date: day(cycle.afterCutDueOn) })}</p>
      )}
    </div>
  );
}
