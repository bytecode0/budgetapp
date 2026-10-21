import { useTranslation } from 'react-i18next';
import type { CardPaymentMode, CardSettingsPayload } from '../../hooks/useAccounts';

// The card part of a card account's form — how it's paid, what's owed now,
// payment day and minimum. Its debt is created and kept in step by the server
// (server/lib/cardDebt.ts). Shared by Accounts and the onboarding's cards step.

export interface CardFieldsValue {
  cardPaymentMode: CardPaymentMode;
  currentBalance: string; // for a card: what's owed now
  cardMinimumPayment: string;
  cardPaymentDueDay: string;
}

export const EMPTY_CARD_FIELDS: CardFieldsValue = {
  cardPaymentMode: 'full', currentBalance: '', cardMinimumPayment: '', cardPaymentDueDay: '',
};

const CARD_PAYMENT_MODES: CardPaymentMode[] = ['full', 'minimum'];

/** The card settings to send with the account (POST/PATCH /api/accounts). */
export function cardSettingsPayload(v: CardFieldsValue): Required<CardSettingsPayload> {
  return {
    cardPaymentMode: v.cardPaymentMode,
    cardMinimumPayment: v.cardPaymentMode === 'minimum' && v.cardMinimumPayment ? parseFloat(v.cardMinimumPayment) : null,
    cardPaymentDueDay: v.cardPaymentDueDay ? parseInt(v.cardPaymentDueDay, 10) : null,
  };
}

interface CardFieldsProps {
  value: CardFieldsValue;
  onChange: (patch: Partial<CardFieldsValue>) => void;
  /** Editing an existing card: what's owed is adjusted, not set from scratch. */
  editing?: boolean;
}

export function CardFields({ value, onChange, editing = false }: CardFieldsProps) {
  const { t } = useTranslation();
  const currency = t('currency.symbol');

  return (
    <>
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.paymentModeLabel')}</label>
        <div className="grid grid-cols-2 gap-2">
          {CARD_PAYMENT_MODES.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ cardPaymentMode: m })}
              className={`py-3 rounded-xl border transition-colors text-xs ${value.cardPaymentMode === m ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
            >
              {t(`debts.paymentMode.${m}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`debts.paymentModeHint.${value.cardPaymentMode}`)}</p>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('accounts.cardOwedLabel')}</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
          <input
            type="number"
            inputMode="decimal"
            value={value.currentBalance}
            onChange={e => onChange({ currentBalance: e.target.value })}
            placeholder="0"
            className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t(editing ? 'accounts.cardOwedAdjustHint' : 'accounts.cardOwedHint')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">{t('debts.paymentDueDayLabel')}</label>
          <input
            type="number"
            min={1}
            max={28}
            value={value.cardPaymentDueDay}
            onChange={e => onChange({ cardPaymentDueDay: e.target.value })}
            placeholder="1-28"
            className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
          />
        </div>
        {value.cardPaymentMode === 'minimum' && (
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{t('debts.minimumPaymentLabel')}</label>
            <input
              type="number"
              inputMode="decimal"
              value={value.cardMinimumPayment}
              onChange={e => onChange({ cardMinimumPayment: e.target.value })}
              placeholder="0"
              className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
            />
          </div>
        )}
      </div>
    </>
  );
}
