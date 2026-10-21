import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CreditCard, Calendar, Car, ShoppingBag, AlertCircle, Wallet, Home, GraduationCap,
} from 'lucide-react';
import type { Debt, DebtKind, DebtPaymentMode, DebtPayload } from '../../hooks/useDebts';

// The debt form's fields (kind, how it's paid, balance, installments with the
// 6/10/12/24 shortcuts, how many are paid…). Shared by Debts and the
// onboarding's loans step; each wraps it with its own title and submit.

export const DEBT_KINDS: DebtKind[] = ['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan', 'student_loan', 'mortgage', 'other'];
// Cards are created in Accounts (their debt follows on its own); here only
// loans and installment plans are created. An existing card can still be edited.
export const NEW_DEBT_KINDS = DEBT_KINDS.filter(k => k !== 'credit_card');
const CARD_LIKE: Set<DebtKind> = new Set(['credit_card']);
const PAYMENT_MODES: DebtPaymentMode[] = ['full', 'installments', 'minimum'];
const INSTALLMENT_SHORTCUTS = [6, 10, 12, 24];

// A new card defaults to "paid in full at month end" (the common Spanish
// card); everything else to fixed installments.
const defaultModeFor = (kind: DebtKind): DebtPaymentMode =>
  kind === 'credit_card' ? 'full' : kind === 'other' ? 'minimum' : 'installments';

export function kindIcon(kind: DebtKind) {
  switch (kind) {
    case 'credit_card': return CreditCard;
    case 'installment':  return Calendar;
    case 'bnpl':          return ShoppingBag;
    case 'payday_loan':  return AlertCircle;
    case 'auto_loan':    return Car;
    case 'student_loan': return GraduationCap;
    case 'mortgage':      return Home;
    default:              return Wallet;
  }
}

export interface DebtFormState {
  id: string | null;
  name: string;
  kind: DebtKind;
  paymentMode: DebtPaymentMode;
  currentBalance: string;
  apr: string;
  creditLimit: string;
  paymentDueDay: string;
  minimumPayment: string;
  installmentAmount: string;
  installmentsTotal: string;
  installmentsPaid: string;
  // As loaded when editing: live values are only sent if the user changed
  // them, so a form left open can't erase a payment recorded meanwhile.
  loadedBalance: string;
  loadedInstallmentsPaid: string;
}

/** A new loan / installment plan. */
export const EMPTY_DEBT_FORM: DebtFormState = {
  id: null, name: '', kind: 'installment', paymentMode: 'installments', currentBalance: '', apr: '', creditLimit: '',
  paymentDueDay: '', minimumPayment: '', installmentAmount: '', installmentsTotal: '', installmentsPaid: '',
  loadedBalance: '', loadedInstallmentsPaid: '',
};

export function debtFormFromDebt(d: Debt): DebtFormState {
  return {
    id: d.id,
    name: d.name,
    kind: d.kind,
    paymentMode: d.paymentMode,
    currentBalance: String(d.currentBalance),
    apr: d.apr != null ? String(d.apr) : '',
    creditLimit: d.creditLimit != null ? String(d.creditLimit) : '',
    paymentDueDay: d.paymentDueDay != null ? String(d.paymentDueDay) : '',
    minimumPayment: d.minimumPayment != null ? String(d.minimumPayment) : '',
    installmentAmount: d.installmentAmount != null ? String(d.installmentAmount) : '',
    installmentsTotal: d.installmentsTotal != null ? String(d.installmentsTotal) : '',
    installmentsPaid: String(d.installmentsPaid ?? 0),
    loadedBalance: String(d.currentBalance),
    loadedInstallmentsPaid: String(d.installmentsPaid ?? 0),
  };
}

/** What to send to POST / PATCH /api/debts. Call only with a non-empty name. */
export function debtPayloadFromForm(form: DebtFormState): DebtPayload {
  const isInstallments = form.paymentMode === 'installments';
  return {
    name: form.name.trim(),
    kind: form.kind,
    paymentMode: form.paymentMode,
    ...((!form.id || form.currentBalance !== form.loadedBalance) && { currentBalance: parseFloat(form.currentBalance) || 0 }),
    apr: form.apr ? parseFloat(form.apr) : null,
    creditLimit: CARD_LIKE.has(form.kind) && form.creditLimit ? parseFloat(form.creditLimit) : null,
    paymentDueDay: form.paymentDueDay ? parseInt(form.paymentDueDay, 10) : null,
    minimumPayment: form.paymentMode === 'minimum' && form.minimumPayment ? parseFloat(form.minimumPayment) : null,
    installmentAmount: isInstallments && form.installmentAmount ? parseFloat(form.installmentAmount) : null,
    installmentsTotal: isInstallments && form.installmentsTotal ? parseInt(form.installmentsTotal, 10) : null,
    ...(isInstallments && (!form.id || form.installmentsPaid !== form.loadedInstallmentsPaid)
      && { installmentsPaid: parseInt(form.installmentsPaid, 10) || 0 }),
  };
}

interface DebtFormFieldsProps {
  form: DebtFormState;
  setForm: Dispatch<SetStateAction<DebtFormState>>;
}

export function DebtFormFields({ form, setForm }: DebtFormFieldsProps) {
  const { t } = useTranslation();
  const currency = t('currency.symbol');
  const isCardLike = CARD_LIKE.has(form.kind);
  const isInstallments = form.paymentMode === 'installments';
  const isMinimum = form.paymentMode === 'minimum';

  return (
    <>
      {/* Name */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.nameLabel')}</label>
        <input
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder={t('debts.namePlaceholder')}
          className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
        />
      </div>

      {/* Kind */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.kindLabel')}</label>
        <div className="grid grid-cols-3 gap-2">
          {(form.id ? DEBT_KINDS : NEW_DEBT_KINDS).map(k => {
            const Icon = kindIcon(k);
            const selected = form.kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setForm(f => ({ ...f, kind: k, ...(!f.id && { paymentMode: defaultModeFor(k) }) }))}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-colors text-xs ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
              >
                <Icon className="w-4 h-4" />
                {t(`debts.kind.${k}`)}
              </button>
            );
          })}
        </div>
        {!form.id && <p className="text-xs text-muted-foreground">{t('debts.cardsInAccountsHint')}</p>}
      </div>

      {/* How it's paid */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.paymentModeLabel')}</label>
        <div className="grid grid-cols-3 gap-2">
          {PAYMENT_MODES.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setForm(f => ({ ...f, paymentMode: m }))}
              className={`py-3 rounded-xl border transition-colors text-xs ${form.paymentMode === m ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
            >
              {t(`debts.paymentMode.${m}`)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t(`debts.paymentModeHint.${form.paymentMode}`)}</p>
      </div>

      {/* Current balance — editing it moves the anchor (server/lib/debtBalance.ts) */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.balanceLabel')}</label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
          <input
            type="number"
            inputMode="decimal"
            value={form.currentBalance}
            onChange={e => setForm(f => ({ ...f, currentBalance: e.target.value }))}
            placeholder="0"
            className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {form.id ? t('debts.balanceAdjustHint') : isCardLike ? t('debts.cardPurchasesHint') : t('debts.balanceNewHint')}
        </p>
      </div>

      {/* APR (all kinds) */}
      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.aprLabel')}</label>
        <div className="relative">
          <input
            type="number"
            step="0.1"
            value={form.apr}
            onChange={e => setForm(f => ({ ...f, apr: e.target.value }))}
            placeholder="0.0"
            className="w-full pr-8 pl-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
        </div>
      </div>

      {isCardLike && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">{t('debts.creditLimitLabel')}</label>
          <input
            type="number"
            inputMode="decimal"
            value={form.creditLimit}
            onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))}
            placeholder="0"
            className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">{t('debts.paymentDueDayLabel')}</label>
        <input
          type="number"
          min={1}
          max={28}
          value={form.paymentDueDay}
          onChange={e => setForm(f => ({ ...f, paymentDueDay: e.target.value }))}
          placeholder="1-28"
          className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
        />
      </div>

      {isMinimum && (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">{t('debts.minimumPaymentLabel')}</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
            <input
              type="number"
              inputMode="decimal"
              value={form.minimumPayment}
              onChange={e => setForm(f => ({ ...f, minimumPayment: e.target.value }))}
              placeholder="0"
              className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {isInstallments && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('debts.installmentAmountLabel')}</label>
              <input
                type="number"
                inputMode="decimal"
                value={form.installmentAmount}
                onChange={e => setForm(f => ({ ...f, installmentAmount: e.target.value }))}
                placeholder="0"
                className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('debts.installmentsTotalLabel')}</label>
              <input
                type="number"
                value={form.installmentsTotal}
                onChange={e => setForm(f => ({ ...f, installmentsTotal: e.target.value }))}
                placeholder="12"
                className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
              />
              <div className="flex gap-1">
                {INSTALLMENT_SHORTCUTS.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, installmentsTotal: String(n) }))}
                    className={`flex-1 py-1 rounded-lg border text-[11px] transition-colors ${form.installmentsTotal === String(n) ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{t('debts.installmentsPaidLabel')}</label>
            <input
              type="number"
              value={form.installmentsPaid}
              onChange={e => setForm(f => ({ ...f, installmentsPaid: e.target.value }))}
              placeholder="0"
              className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
            />
          </div>
        </>
      )}
    </>
  );
}
