// The draft shape and payload conversion for the manual "fill the gaps"
// step, extracted from the retired Block1Form wizard (the 5-screen UI that
// rendered these). FinancialContextBlock is the only current renderer, and
// reuses the shape as-is rather than redefining it.
import type { DebtKind } from '../types';
import type { FieldInput, DebtInput } from './onboardingApi';

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
  savingMonthly: '0',
  investmentMonthly: '0',
  givingMonthly: '',
  accountBalance: '',
  assetsCuasiEfectivo: '0',
  assetsMercadoVolatil: '0',
  assetsBloqueado: '0',
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
