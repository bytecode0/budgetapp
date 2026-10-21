import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Landmark, PiggyBank, WalletCards } from 'lucide-react';
import { PageShell } from '../ui/PageShell';
import { Panel } from '../ui/primitives';
import type { Block1Draft } from './block1Draft';

interface Props {
  draft: Block1Draft;
  onChange: (draft: Block1Draft) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
  // Keys of the draft that were filled in from the uploaded statement, so the
  // person who already reviewed those figures isn't asked the same thing twice
  // without being told why the box is already full.
  prefilled: string[];
}

const asCents = (value: string) => Math.round(Number.parseFloat(value.replace(',', '.')) * 100);
const isAmount = (value: string) => Number.isFinite(asCents(value)) && asCents(value) >= 0;
const isPositiveAmount = (value: string) => Number.isFinite(asCents(value)) && asCents(value) > 0;

interface AmountInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  invalid?: boolean;
  invalidText?: string;
  // Shows a one-tap "I don't have any" chip that writes an explicit 0. An
  // empty box is never read as zero: inferring "no cushion" from silence would
  // hand someone a stage classification they never actually answered for.
  allowNone?: boolean;
  fromStatement?: boolean;
}

function AmountInput({ label, value, onChange, required, invalid, invalidText, allowNone, fromStatement }: AmountInputProps) {
  const { t } = useTranslation();
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</span>
        {fromStatement && <span className="text-[10px] uppercase text-primary border border-primary/30 rounded-full px-1.5 py-0.5" style={{ letterSpacing: '0.08em' }}>{t('radiografia.onboarding.context.fromStatement')}</span>}
      </span>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{t('radiografia.currencySymbol')}</span>
          <input
            value={value}
            inputMode="decimal"
            placeholder="0"
            onChange={event => onChange(event.target.value.replace(/[^0-9,.]/g, ''))}
            className={`w-full pl-8 pr-4 py-3 border rounded-xl bg-background outline-none text-sm transition-colors ${invalid ? 'border-destructive focus:border-destructive' : 'border-border focus:border-primary'}`}
          />
        </div>
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange('0')}
            className={`px-3 py-3 rounded-xl border text-xs whitespace-nowrap transition-colors ${value === '0' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}
          >
            {t('radiografia.onboarding.context.noneChip')}
          </button>
        )}
      </div>
      {invalid && invalidText && <span className="block text-xs text-destructive">{invalidText}</span>}
    </label>
  );
}

export function FinancialContextBlock({ draft, onChange, onSubmit, onBack, submitting, prefilled }: Props) {
  const { t } = useTranslation();
  const [showValidation, setShowValidation] = useState(false);
  const patch = (next: Partial<Block1Draft>) => onChange({ ...draft, ...next });
  const wasPrefilled = (key: string) => prefilled.includes(key);

  // Income must be strictly positive: every figure in the report is a
  // percentage of it, and an income of 0 yields a report that reads as if the
  // person spends nothing on anything (see the guard in
  // server/lib/radiografia/report.ts).
  const incomeMissing = !isAmount(draft.income);
  const incomeNotPositive = !incomeMissing && !isPositiveAmount(draft.income);
  const hasDebtAmount = draft.debts.some(debt => isPositiveAmount(debt.monthlyPayment));
  const debtMissing = !draft.debtsNone && !hasDebtAmount;

  const missing = {
    income: incomeMissing,
    housingPayment: !isAmount(draft.housingPayment),
    essentialsTotal: !isAmount(draft.essentialsTotal),
    accountBalance: !isAmount(draft.accountBalance),
    assetsCuasiEfectivo: !isAmount(draft.assetsCuasiEfectivo),
  };
  const missingLabels = [
    missing.income && t('radiografia.onboarding.context.incomeLabel'),
    missing.housingPayment && t('radiografia.onboarding.context.housingLabel'),
    missing.essentialsTotal && t('radiografia.onboarding.context.essentialsLabel'),
    missing.accountBalance && t('radiografia.onboarding.context.balanceLabel'),
    missing.assetsCuasiEfectivo && t('radiografia.onboarding.context.availableSavingsLabel'),
    debtMissing && t('radiografia.onboarding.context.debtPaymentLabel'),
  ].filter(Boolean).join(', ');

  const canContinue = !Object.values(missing).some(Boolean) && !incomeNotPositive && !debtMissing;
  const fieldMissing = t('radiografia.onboarding.context.fieldMissing');

  const continueFlow = () => {
    if (!canContinue) {
      setShowValidation(true);
      return;
    }
    onSubmit();
  };

  return (
    <PageShell step={3}>
      <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-4 h-4" />
        {t('radiografia.onboarding.context.back')}
      </button>

      <div className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-display leading-tight">{t('radiografia.onboarding.context.title')}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">{t('radiografia.onboarding.context.subtitle')}</p>
      </div>

      <Panel>
        <div className="space-y-6">
          <section className="space-y-4">
            <div className="flex items-center gap-3"><WalletCards className="w-5 h-5 text-primary" /><h2 className="font-display text-lg">{t('radiografia.onboarding.context.cashflowTitle')}</h2></div>
            <AmountInput
              label={t('radiografia.onboarding.context.incomeLabel')}
              value={draft.income}
              onChange={income => patch({ income })}
              required
              fromStatement={wasPrefilled('income')}
              invalid={showValidation && (missing.income || incomeNotPositive)}
              invalidText={incomeNotPositive ? t('radiografia.onboarding.context.incomePositive') : fieldMissing}
            />
            <div className="grid sm:grid-cols-2 gap-4">
              <AmountInput label={t('radiografia.onboarding.context.housingLabel')} value={draft.housingPayment} onChange={housingPayment => patch({ housingPayment })} required allowNone invalid={showValidation && missing.housingPayment} invalidText={fieldMissing} />
              <AmountInput label={t('radiografia.onboarding.context.essentialsLabel')} value={draft.essentialsTotal} onChange={essentialsTotal => patch({ essentialsTotal })} required invalid={showValidation && missing.essentialsTotal} invalidText={fieldMissing} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <AmountInput label={t('radiografia.onboarding.context.savingLabel')} value={draft.savingMonthly} onChange={savingMonthly => patch({ savingMonthly })} allowNone fromStatement={wasPrefilled('savingMonthly')} />
              <AmountInput label={t('radiografia.onboarding.context.investmentLabel')} value={draft.investmentMonthly} onChange={investmentMonthly => patch({ investmentMonthly })} allowNone fromStatement={wasPrefilled('investmentMonthly')} />
            </div>
          </section>

          <section className="space-y-4 pt-2 border-t border-border">
            <div className="flex items-center gap-3"><PiggyBank className="w-5 h-5 text-primary" /><h2 className="font-display text-lg">{t('radiografia.onboarding.context.cushionTitle')}</h2></div>
            <div className="grid sm:grid-cols-2 gap-4">
              <AmountInput label={t('radiografia.onboarding.context.balanceLabel')} value={draft.accountBalance} onChange={accountBalance => patch({ accountBalance })} required allowNone fromStatement={wasPrefilled('accountBalance')} invalid={showValidation && missing.accountBalance} invalidText={fieldMissing} />
              <AmountInput label={t('radiografia.onboarding.context.availableSavingsLabel')} value={draft.assetsCuasiEfectivo} onChange={assetsCuasiEfectivo => patch({ assetsCuasiEfectivo })} required allowNone invalid={showValidation && missing.assetsCuasiEfectivo} invalidText={fieldMissing} />
            </div>
          </section>

          <section className="space-y-4 pt-2 border-t border-border">
            <div className="flex items-center gap-3"><Landmark className="w-5 h-5 text-primary" /><h2 className="font-display text-lg">{t('radiografia.onboarding.context.debtTitle')}</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => patch({ debtsNone: true, debts: [] })} className={`py-3 rounded-xl border text-sm transition-colors ${draft.debtsNone ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}>{t('radiografia.onboarding.context.noDebts')}</button>
              <button onClick={() => patch({ debtsNone: false, debts: draft.debts.length ? draft.debts : [{ id: 'context-debt', kind: 'other', monthlyPayment: '', outstandingBalance: '' }] })} className={`py-3 rounded-xl border text-sm transition-colors ${!draft.debtsNone ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}>{t('radiografia.onboarding.context.hasDebts')}</button>
            </div>
            {!draft.debtsNone && (
              <AmountInput
                label={t('radiografia.onboarding.context.debtPaymentLabel')}
                value={draft.debts[0]?.monthlyPayment ?? ''}
                onChange={monthlyPayment => patch({ debts: [{ id: draft.debts[0]?.id ?? 'context-debt', kind: 'other', monthlyPayment, outstandingBalance: '' }] })}
                required
                invalid={showValidation && debtMissing}
                invalidText={t('radiografia.onboarding.context.debtPositive')}
              />
            )}
          </section>
        </div>
      </Panel>

      {/* The message sits above the button, not below it: a person who taps
          and nothing happens looks up from the button, not past it. The
          button itself is never disabled — a dead control with no stated
          reason is the thing being fixed here. */}
      {showValidation && !canContinue && (
        <p className="text-sm text-destructive text-center">
          {missingLabels
            ? t('radiografia.onboarding.context.completeFields', { fields: missingLabels })
            : t('radiografia.onboarding.context.incomePositive')}
        </p>
      )}
      <button onClick={continueFlow} disabled={submitting} className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50">
        {submitting ? t('radiografia.onboarding.context.saving') : t('radiografia.onboarding.context.continue')}
      </button>
      <p className="text-xs text-muted-foreground text-center">{t('radiografia.onboarding.context.requiredHint')}</p>
    </PageShell>
  );
}
