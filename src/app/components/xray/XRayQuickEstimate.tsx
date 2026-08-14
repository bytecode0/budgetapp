import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { ArrowLeft, Plus, Trash2, CreditCard, Calendar, ShoppingBag, AlertCircle, Car, Wallet } from 'lucide-react';
import { XRayMark } from './XRayMark';
import type { DebtKind } from './types';

// Same taxonomy as the authenticated Debts module (useDebts.ts / Debts.tsx) —
// the Radiografía reuses the Debt model's `kind` values, not a new one.
const DEBT_KINDS: DebtKind[] = ['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan', 'other'];

// Mirrors Debts.tsx's kindIcon() for the same icon-per-kind mapping. Not
// imported directly — Debts.tsx is an authenticated component, this is public.
function kindIcon(kind: DebtKind) {
  switch (kind) {
    case 'credit_card': return CreditCard;
    case 'installment': return Calendar;
    case 'bnpl': return ShoppingBag;
    case 'payday_loan': return AlertCircle;
    case 'auto_loan': return Car;
    default: return Wallet;
  }
}

interface DebtRow { id: string; name: string; kind: DebtKind; monthlyPayment: string }

let rowSeq = 0;
const newRow = (): DebtRow => ({ id: `row-${++rowSeq}`, name: '', kind: 'installment', monthlyPayment: '' });

interface Props {
  onSubmit: (monthlyIncome: number, debts: { name: string; kind: DebtKind; monthlyPayment: number }[]) => Promise<{ error?: string }>;
  onBack: () => void;
}

export function XRayQuickEstimate({ onSubmit, onBack }: Props) {
  const { t } = useTranslation();
  const [income, setIncome] = useState('');
  const [rows, setRows] = useState<DebtRow[]>([newRow()]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addRow = () => setRows(r => [...r, newRow()]);
  const removeRow = (id: string) => setRows(r => (r.length > 1 ? r.filter(x => x.id !== id) : r));
  const updateRow = (id: string, patch: Partial<DebtRow>) => setRows(r => r.map(x => (x.id === id ? { ...x, ...patch } : x)));

  const incomeNum = parseFloat(income.replace(',', '.'));
  const validRows = rows.filter(r => r.name.trim() && parseFloat(r.monthlyPayment.replace(',', '.')) > 0);
  const canSubmit = Number.isFinite(incomeNum) && incomeNum > 0 && validRows.length > 0 && !sending;

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    setError(null);
    const debts = validRows.map(r => ({ name: r.name.trim(), kind: r.kind, monthlyPayment: parseFloat(r.monthlyPayment.replace(',', '.')) }));
    const { error: err } = await onSubmit(incomeNum, debts);
    setSending(false);
    if (err) setError(err);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-6 py-16 md:py-24">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-xl space-y-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('radiografia.quickEstimate.back')}
        </button>

        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2.5 justify-center">
            <XRayMark className="w-7 h-7" />
            <span className="text-sm text-primary uppercase" style={{ letterSpacing: '0.1em' }}>
              {t('radiografia.quickEstimate.badge')}
            </span>
          </div>
          <h1 className="text-3xl md:text-4xl font-display tracking-tight leading-tight">
            {t('radiografia.quickEstimate.title')}
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">{t('radiografia.quickEstimate.subtitle')}</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
          <div>
            <label className="text-xs text-muted-foreground">{t('radiografia.quickEstimate.incomeLabel')}</label>
            <div className="relative mt-1.5">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={income}
                onChange={e => setIncome(e.target.value)}
                className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
              />
            </div>
          </div>

          <div className="space-y-3">
            {rows.map(row => {
              const Icon = kindIcon(row.kind);
              return (
                <div key={row.id} className="flex flex-wrap items-center gap-2 bg-muted/40 rounded-xl p-3">
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                  <input
                    type="text"
                    placeholder={t('radiografia.quickEstimate.debtName')}
                    value={row.name}
                    onChange={e => updateRow(row.id, { name: e.target.value })}
                    className="flex-1 min-w-[8rem] border border-border rounded-lg px-3 py-2 bg-background outline-none focus:border-primary text-sm"
                  />
                  <select
                    aria-label={t('radiografia.quickEstimate.debtKind')}
                    value={row.kind}
                    onChange={e => updateRow(row.id, { kind: e.target.value as DebtKind })}
                    className="border border-border rounded-lg px-2 py-2 bg-background outline-none focus:border-primary text-sm shrink-0"
                  >
                    {DEBT_KINDS.map(k => (
                      <option key={k} value={k}>{t(`debts.kind.${k}`)}</option>
                    ))}
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
                    disabled={rows.length === 1}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0 disabled:opacity-30"
                    aria-label={t('radiografia.quickEstimate.removeDebt')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
            <button
              onClick={addRow}
              className="w-full py-2.5 border border-dashed border-border rounded-xl text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              {t('radiografia.quickEstimate.addDebt')}
            </button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{t(`radiografia.errors.${error}`, t('radiografia.errors.generic'))}</p>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50"
          >
            {sending ? t('radiografia.quickEstimate.submitting') : t('radiografia.quickEstimate.submit')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
