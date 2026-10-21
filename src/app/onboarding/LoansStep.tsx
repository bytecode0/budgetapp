import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useDebts } from '../hooks/useDebts';
import {
  DebtFormFields, EMPTY_DEBT_FORM, debtPayloadFromForm, kindIcon, type DebtFormState,
} from '../components/shared/DebtFormFields';
import { useMoney } from './useMoney';

// Loans and installment plans (car, Klarna, payday loans, mortgage…), with
// the same form as Debts. The server creates each debt's budget line.
// Cards were the previous step: their debts aren't listed here.
export function LoansStep() {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { debts, createDebt, deleteDebt } = useDebts();
  const loans = debts.filter(d => d.kind !== 'credit_card');

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<DebtFormState>(EMPTY_DEBT_FORM);
  const [saving, setSaving] = useState(false);

  const reset = () => { setAdding(false); setForm(EMPTY_DEBT_FORM); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error(t('debts.nameRequired')); return; }
    setSaving(true);
    const result = await createDebt(debtPayloadFromForm(form));
    setSaving(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    toast.success(t('onboarding.loans.createdOk'));
    reset();
  };

  const handleDelete = async (id: string) => {
    const result = await deleteDebt(id);
    if (result.error) toast.error(result.code === 'debt_has_payments' ? t('debts.hasPaymentsError') : result.error);
  };

  return (
    <div>
      <div className="space-y-3 mb-4">
        {loans.map(d => {
          const Icon = kindIcon(d.kind);
          return (
            <div key={d.id} className="bg-card p-5 rounded-2xl border border-border flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display truncate">{d.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t(`debts.kind.${d.kind}`)}
                  {d.installmentsTotal != null && ` · ${d.installmentsPaid}/${d.installmentsTotal} ${t('debts.installments')}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-display">{fmt(d.monthlyCommitment)} <span className="text-xs text-muted-foreground">{t('debts.perPeriod')}</span></p>
                {d.currentBalance > 0 && (
                  <p className="text-xs text-muted-foreground">{t('onboarding.loans.owedLabel')} {fmt(d.currentBalance)}</p>
                )}
              </div>
              <button onClick={() => handleDelete(d.id)} className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/5 transition-colors" title={t('debts.delete')}>
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="bg-card p-6 rounded-2xl border border-border space-y-5">
          <DebtFormFields form={form} setForm={setForm} />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('onboarding.loans.save')}
            </button>
            <button onClick={reset} className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm">
              {t('onboarding.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-2 px-6 py-4 border-2 border-dashed border-border rounded-xl text-muted-foreground hover:text-secondary hover:border-secondary hover:bg-secondary/5 font-medium transition-all"
        >
          <Plus className="w-4 h-4" /> {t('onboarding.loans.add')}
        </button>
      )}

      {loans.length === 0 && !adding && (
        <p className="mt-6 text-center text-sm text-muted-foreground">{t('onboarding.loans.noLoans')}</p>
      )}

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 mt-8 flex gap-3 text-sm text-amber-800 dark:text-amber-400">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>{t('onboarding.loans.note')}</div>
      </div>
    </div>
  );
}
