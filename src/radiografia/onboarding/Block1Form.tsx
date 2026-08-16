import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Plus, Trash2, CreditCard, Calendar, ShoppingBag, AlertCircle, Car, Home, Wallet, ArrowLeft } from 'lucide-react';
import { XRayMark } from '../XRayMark';
import type { DebtKind } from '../types';
import type { FieldInput, DebtInput } from './onboardingApi';

// Same taxonomy as XRayQuickEstimate/the authenticated Debts module, plus
// "mortgage" — the stage engine excludes it from "libre de deudas" (a
// mortgage is a long-term secured commitment, not consumer debt; same
// treatment server/lib/xray/debts.ts already gives it for the statement
// path), so manual entry needs a way to mark a row as one.
const DEBT_KINDS: DebtKind[] = ['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan', 'mortgage', 'other'];

function kindIcon(kind: DebtKind) {
  switch (kind) {
    case 'credit_card': return CreditCard;
    case 'installment': return Calendar;
    case 'bnpl': return ShoppingBag;
    case 'payday_loan': return AlertCircle;
    case 'auto_loan': return Car;
    case 'mortgage': return Home;
    default: return Wallet;
  }
}

interface DebtRow { id: string; kind: DebtKind; monthlyPayment: string; outstandingBalance: string }
let rowSeq = 0;
const newRow = (): DebtRow => ({ id: `row-${++rowSeq}`, kind: 'installment', monthlyPayment: '', outstandingBalance: '' });

export interface Block1Draft {
  incomeType: 'regular' | 'irregular';
  income: string;
  housingPayment: string;
  essentialsTotal: string;
  enjoymentTotal: string;
  savingMonthly: string;
  investmentMonthly: string;
  givingMonthly: string;
  accountBalance: string;
  assetsCuasiEfectivo: string;
  assetsMercadoVolatil: string;
  assetsBloqueado: string;
  debtsNone: boolean;
  debts: DebtRow[];
}

export const emptyBlock1Draft = (): Block1Draft => ({
  incomeType: 'regular',
  income: '',
  housingPayment: '',
  essentialsTotal: '',
  enjoymentTotal: '',
  savingMonthly: '',
  investmentMonthly: '',
  givingMonthly: '',
  accountBalance: '',
  assetsCuasiEfectivo: '',
  assetsMercadoVolatil: '',
  assetsBloqueado: '',
  debtsNone: false,
  debts: [newRow()],
});

const toCents = (v: string) => Math.round(parseFloat(v.replace(',', '.')) * 100);
const isFilled = (v: string) => Number.isFinite(toCents(v)) && toCents(v) >= 0;

export function draftToPayload(d: Block1Draft): { fields: FieldInput[]; debts: DebtInput[]; debtsNone: boolean } {
  const fields: FieldInput[] = [];
  // Required fields are only reachable here once the wizard's own step-by-step
  // gating has already required them, so they're always filled; optional ones
  // default to 0 — "a user with no investments answers 0 in two buckets, never
  // an extra step for it".
  const push = (key: string, v: string) => fields.push({ key, valueCents: isFilled(v) ? toCents(v) : 0 });
  push(d.incomeType === 'irregular' ? 'income_floor' : 'income_regular', d.income);
  push('housing_payment', d.housingPayment);
  push('essentials_total', d.essentialsTotal);
  push('enjoyment_total', d.enjoymentTotal);
  push('saving_monthly', d.savingMonthly);
  push('investment_monthly', d.investmentMonthly);
  push('giving_monthly', d.givingMonthly);
  push('account_balance', d.accountBalance);
  push('assets_cuasi_efectivo', d.assetsCuasiEfectivo);
  push('assets_mercado_volatil', d.assetsMercadoVolatil);
  push('assets_bloqueado', d.assetsBloqueado);

  const debts: DebtInput[] = d.debtsNone
    ? []
    : d.debts
        .filter(r => isFilled(r.monthlyPayment) && toCents(r.monthlyPayment) > 0)
        .map(r => ({
          kind: r.kind,
          monthlyPayment: toCents(r.monthlyPayment),
          outstandingBalance: isFilled(r.outstandingBalance) ? toCents(r.outstandingBalance) : undefined,
        }));

  return { fields, debts, debtsNone: d.debtsNone };
}

// One wizard screen per bucket of the 10/50/20/20 framework, in the order the
// product owner asked for — this is what CLAUDE.md already documents as the
// convention for this form ("wizard paso a paso lineal, Back/Next, no FAB");
// showing all ~12 fields on one page made the total volume of work visible
// upfront and drove abandonment before the user even started.
type Substep = 'income' | 'expenses' | 'debts' | 'extras' | 'accounts';
const SUBSTEP_ORDER: Substep[] = ['income', 'expenses', 'debts', 'extras', 'accounts'];

const STORAGE_SUBSTEP = 'radiografia_v2:block1substep';

function loadSubstep(): Substep {
  const raw = sessionStorage.getItem(STORAGE_SUBSTEP);
  return (SUBSTEP_ORDER as string[]).includes(raw ?? '') ? (raw as Substep) : 'income';
}
function saveSubstep(s: Substep) {
  sessionStorage.setItem(STORAGE_SUBSTEP, s);
}
function clearSubstep() {
  sessionStorage.removeItem(STORAGE_SUBSTEP);
}

// Gates "Siguiente"/"Continuar" per step, not the whole form at once — the
// step itself is the feedback ("this step isn't done yet"), no separate error
// state needed.
function canAdvance(s: Substep, d: Block1Draft): boolean {
  switch (s) {
    case 'income': return isFilled(d.income);
    case 'expenses': return isFilled(d.housingPayment) && isFilled(d.essentialsTotal);
    case 'debts': return d.debtsNone || d.debts.some(r => isFilled(r.monthlyPayment) && toCents(r.monthlyPayment) > 0);
    case 'extras': return true;
    case 'accounts': return isFilled(d.accountBalance) && isFilled(d.assetsCuasiEfectivo);
  }
}

function AmountField({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</label>
      <div className="relative mt-1.5">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="0"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
        />
      </div>
    </div>
  );
}

interface Props {
  draft: Block1Draft;
  onChange: (draft: Block1Draft) => void;
  onSubmit: () => void;
  submitting: boolean;
}

export function Block1Form({ draft, onChange, onSubmit, submitting }: Props) {
  const { t } = useTranslation();
  const patch = (p: Partial<Block1Draft>) => onChange({ ...draft, ...p });
  const [substep, setSubstep] = useState<Substep>(loadSubstep);

  const addRow = () => patch({ debts: [...draft.debts, newRow()] });
  const removeRow = (id: string) => patch({ debts: draft.debts.length > 1 ? draft.debts.filter(r => r.id !== id) : draft.debts });
  const updateRow = (id: string, p: Partial<DebtRow>) => patch({ debts: draft.debts.map(r => (r.id === id ? { ...r, ...p } : r)) });

  const stepIndex = SUBSTEP_ORDER.indexOf(substep);
  const isFirstStep = stepIndex === 0;
  const isLastStep = substep === 'accounts';
  const stepValid = canAdvance(substep, draft);

  const goBack = () => {
    const prev = SUBSTEP_ORDER[stepIndex - 1];
    if (prev) { setSubstep(prev); saveSubstep(prev); }
  };
  const goNext = () => {
    const next = SUBSTEP_ORDER[stepIndex + 1];
    if (next) { setSubstep(next); saveSubstep(next); }
  };
  const handlePrimary = () => {
    if (!stepValid) return;
    if (isLastStep) { clearSubstep(); onSubmit(); return; }
    goNext();
  };

  const stepTitleKey = {
    income: 'stepIncomeTitle',
    expenses: 'stepExpensesTitle',
    debts: 'stepDebtsTitle',
    extras: 'stepExtrasTitle',
    accounts: 'stepAccountsTitle',
  }[substep];

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-6 py-16 md:py-24">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2.5 justify-center">
            <XRayMark className="w-7 h-7" />
            <span className="text-sm text-primary uppercase" style={{ letterSpacing: '0.1em' }}>
              {t('radiografia.onboarding.block1.badge')}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-display tracking-tight leading-tight">
            {t(`radiografia.onboarding.block1.${stepTitleKey}`)}
          </h1>
          {isFirstStep && (
            <p className="text-muted-foreground max-w-lg mx-auto">{t('radiografia.onboarding.block1.subtitle')}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {SUBSTEP_ORDER.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-primary' : 'bg-border'}`} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground text-center -mt-4">
          {t('radiografia.onboarding.block1.progress', { current: stepIndex + 1, total: SUBSTEP_ORDER.length })}
        </p>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-5 overflow-hidden">
          {/* A plain key-change remount (enter-only, no AnimatePresence/exit) —
              AnimatePresence's mode="wait" here would sometimes never resolve
              its exit phase, permanently freezing the step content on the
              previous substep while the title/progress bar (outside this
              block) had already moved on. Losing the exit-fade is a fine
              trade for a transition that can't get stuck. */}
          <motion.div
            key={substep}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-5"
          >
              {substep === 'income' && (
                <>
                  <div className="flex gap-2">
                    <button
                      onClick={() => patch({ incomeType: 'regular' })}
                      className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${draft.incomeType === 'regular' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {t('radiografia.onboarding.block1.incomeRegular')}
                    </button>
                    <button
                      onClick={() => patch({ incomeType: 'irregular' })}
                      className={`flex-1 py-2 rounded-xl text-sm border transition-colors ${draft.incomeType === 'irregular' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {t('radiografia.onboarding.block1.incomeIrregular')}
                    </button>
                  </div>
                  <AmountField
                    label={t(draft.incomeType === 'irregular' ? 'radiografia.onboarding.block1.incomeFloorLabel' : 'radiografia.onboarding.block1.incomeLabel')}
                    value={draft.income}
                    onChange={v => patch({ income: v })}
                    required
                  />
                </>
              )}

              {substep === 'expenses' && (
                <>
                  <AmountField label={t('radiografia.onboarding.block1.housingLabel')} value={draft.housingPayment} onChange={v => patch({ housingPayment: v })} required />
                  <AmountField label={t('radiografia.onboarding.block1.essentialsLabel')} value={draft.essentialsTotal} onChange={v => patch({ essentialsTotal: v })} required />
                  <AmountField label={t('radiografia.onboarding.block1.enjoymentLabel')} value={draft.enjoymentTotal} onChange={v => patch({ enjoymentTotal: v })} />
                </>
              )}

              {substep === 'debts' && (
                <div className="space-y-3">
                  {!draft.debtsNone && draft.debts.map(row => {
                    const Icon = kindIcon(row.kind);
                    return (
                      <div key={row.id} className="flex flex-wrap items-center gap-2 bg-muted/40 rounded-xl p-3">
                        <Icon className="w-4 h-4 text-primary shrink-0" />
                        <select
                          aria-label={t('radiografia.quickEstimate.debtKind')}
                          value={row.kind}
                          onChange={e => updateRow(row.id, { kind: e.target.value as DebtKind })}
                          className="border border-border rounded-lg px-2 py-2 bg-background outline-none focus:border-primary text-sm shrink-0"
                        >
                          {DEBT_KINDS.map(k => <option key={k} value={k}>{t(`debts.kind.${k}`)}</option>)}
                        </select>
                        <div className="relative shrink-0 w-28">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">€</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            placeholder={t('radiografia.quickEstimate.debtAmount')}
                            value={row.monthlyPayment}
                            onChange={e => updateRow(row.id, { monthlyPayment: e.target.value })}
                            className="w-full pl-6 pr-2 py-2 border border-border rounded-lg bg-background outline-none focus:border-primary text-sm"
                          />
                        </div>
                        <button
                          onClick={() => removeRow(row.id)}
                          disabled={draft.debts.length === 1}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0 disabled:opacity-30"
                          aria-label={t('radiografia.quickEstimate.removeDebt')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                  {!draft.debtsNone && (
                    <button
                      onClick={addRow}
                      className="w-full py-2.5 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      {t('radiografia.quickEstimate.addDebt')}
                    </button>
                  )}
                  <button
                    onClick={() => patch({ debtsNone: !draft.debtsNone })}
                    className={`w-full py-2.5 rounded-xl text-sm border transition-colors ${draft.debtsNone ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {t('radiografia.onboarding.block1.noDebts')}
                  </button>
                </div>
              )}

              {substep === 'extras' && (
                <>
                  <AmountField label={t('radiografia.onboarding.block1.savingLabel')} value={draft.savingMonthly} onChange={v => patch({ savingMonthly: v })} />
                  <AmountField label={t('radiografia.onboarding.block1.investmentLabel')} value={draft.investmentMonthly} onChange={v => patch({ investmentMonthly: v })} />
                  <AmountField label={t('radiografia.onboarding.block1.givingLabel')} value={draft.givingMonthly} onChange={v => patch({ givingMonthly: v })} />
                </>
              )}

              {substep === 'accounts' && (
                <>
                  <AmountField label={t('radiografia.onboarding.block1.accountBalanceLabel')} value={draft.accountBalance} onChange={v => patch({ accountBalance: v })} required />
                  <AmountField label={t('radiografia.onboarding.block1.cuasiEfectivoLabel')} value={draft.assetsCuasiEfectivo} onChange={v => patch({ assetsCuasiEfectivo: v })} required />
                  <AmountField label={t('radiografia.onboarding.block1.mercadoVolatilLabel')} value={draft.assetsMercadoVolatil} onChange={v => patch({ assetsMercadoVolatil: v })} />
                  <AmountField label={t('radiografia.onboarding.block1.bloqueadoLabel')} value={draft.assetsBloqueado} onChange={v => patch({ assetsBloqueado: v })} />
                </>
              )}
          </motion.div>

          <div className="flex gap-2 pt-2">
            {!isFirstStep && (
              <button
                onClick={goBack}
                className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm flex items-center gap-1.5 shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('radiografia.onboarding.block1.back')}
              </button>
            )}
            <button
              onClick={handlePrimary}
              disabled={!stepValid || (isLastStep && submitting)}
              className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50"
            >
              {isLastStep
                ? (submitting ? t('radiografia.onboarding.block1.submitting') : t('radiografia.onboarding.block1.submit'))
                : t('radiografia.onboarding.block1.next')}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
