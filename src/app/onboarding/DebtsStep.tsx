import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Trash2, Loader2, CreditCard, Calendar, Car, ShoppingBag, AlertCircle, Home, Wallet, GraduationCap, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDebts, type DebtKind } from '../hooks/useDebts';

interface DebtsStepProps {
  onSkip: () => void;
}

const DEBT_KINDS: DebtKind[] = ['credit_card', 'installment', 'auto_loan', 'mortgage', 'student_loan', 'other'];

// Método Ruta R3: the frontier is the TYPE of debt, never the interest rate.
// credit_card/installment/bnpl/payday_loan/auto_loan/student_loan (R3.1) are
// always inadmissible — always the snowball's attack target, at any APR,
// including 0%. mortgage (R3.2) is tolerable if the rate is reasonable and the
// payment doesn't choke cash flow. Classification is automatic, never a
// question asked to the user.
const CONSUMER_KINDS = new Set<DebtKind>(['credit_card', 'installment', 'bnpl', 'payday_loan', 'auto_loan', 'student_loan']);

function kindIcon(kind: DebtKind) {
  switch (kind) {
    case 'credit_card': return CreditCard;
    case 'installment': return Calendar;
    case 'bnpl': return ShoppingBag;
    case 'payday_loan': return AlertCircle;
    case 'auto_loan': return Car;
    case 'student_loan': return GraduationCap;
    case 'mortgage': return Home;
    default: return Wallet;
  }
}

interface DraftDebt {
  name: string;
  kind: DebtKind;
  currentBalance: string;
  monthlyPayment: string;
  apr: string;
}

const emptyDraft = (): DraftDebt => ({ name: '', kind: 'credit_card', currentBalance: '', monthlyPayment: '', apr: '' });

export function DebtsStep({ onSkip }: DebtsStepProps) {
  const { t } = useTranslation();
  const { debts, createDebt, deleteDebt } = useDebts();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftDebt>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const isCreditCard = draft.kind === 'credit_card';
  const isMortgage = draft.kind === 'mortgage';
  const aprTooHigh = isMortgage && draft.apr !== '' && parseFloat(draft.apr) >= 8;

  const handleAdd = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    const result = await createDebt({
      name: draft.name.trim(),
      kind: draft.kind,
      currentBalance: parseFloat(draft.currentBalance) || 0,
      apr: draft.apr ? parseFloat(draft.apr) : null,
      ...(isCreditCard
        ? { minimumPayment: parseFloat(draft.monthlyPayment) || 0 }
        : { installmentAmount: parseFloat(draft.monthlyPayment) || 0 }),
    });
    setSaving(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    setDraft(emptyDraft());
    setAdding(false);
  };

  return (
    <div>
      <div className="space-y-4 mb-4">
        {debts.map((d, i) => {
          const Icon = kindIcon(d.kind);
          return (
            <div key={d.id} className="bg-card p-6 sm:p-8 rounded-2xl shadow-sm border border-border">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  {d.name}
                </h3>
                <button onClick={() => deleteDebt(d.id)} className="text-destructive/70 hover:text-destructive p-2 -mr-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-6 mt-4 text-sm">
                <div>
                  <span className="text-muted-foreground block text-xs mb-0.5">{t('onboarding.debts.balanceLabel')}</span>
                  <span className="font-display text-lg">€{d.currentBalance.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs mb-0.5">{t('onboarding.debts.monthlyPaymentLabel')}</span>
                  <span className="font-display text-lg">€{(d.minimumPayment ?? d.installmentAmount ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="bg-card p-6 sm:p-8 rounded-2xl shadow-sm border border-border space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t('onboarding.debts.typeLabel')}</label>
              <div className="relative">
                <select
                  value={draft.kind}
                  onChange={e => setDraft(d => ({ ...d, kind: e.target.value as DebtKind }))}
                  className="block w-full pl-4 pr-10 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary appearance-none cursor-pointer"
                >
                  {DEBT_KINDS.map(k => (
                    <option key={k} value={k}>{t(`debts.kind.${k}`)}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t('onboarding.debts.nameLabel')}</label>
              <input
                autoFocus
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder={t('onboarding.debts.namePlaceholder') as string}
                className="block w-full px-4 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">{t('onboarding.debts.balanceLabel')}</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">€</span>
              <input
                type="number" inputMode="decimal" value={draft.currentBalance}
                onChange={e => setDraft(d => ({ ...d, currentBalance: e.target.value }))}
                placeholder="0.00"
                className="block w-full pl-8 pr-4 py-4 text-xl font-display border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">
              {isCreditCard ? t('onboarding.debts.minimumPaymentLabel') : t('onboarding.debts.installmentLabel')}
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">€</span>
              <input
                type="number" inputMode="decimal" value={draft.monthlyPayment}
                onChange={e => setDraft(d => ({ ...d, monthlyPayment: e.target.value }))}
                placeholder="0.00"
                className="block w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary"
              />
            </div>
          </div>

          {isMortgage && (
            <div className="space-y-2">
              <label className="block text-sm font-medium">{t('onboarding.debts.aprLabel')}</label>
              <input
                type="number" inputMode="decimal" value={draft.apr}
                onChange={e => setDraft(d => ({ ...d, apr: e.target.value }))}
                placeholder="3.5"
                className="block w-full px-4 py-3 border border-border rounded-xl bg-muted/40 focus:bg-background outline-none focus:border-secondary"
              />
              {aprTooHigh && (
                <p className="text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  {t('onboarding.debts.aprWarning')}
                </p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleAdd}
              disabled={saving || !draft.name.trim()}
              className="flex-1 py-3 bg-foreground text-background rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('onboarding.debts.save')}
            </button>
            <button onClick={() => { setAdding(false); setDraft(emptyDraft()); }} className="px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
              {t('onboarding.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-4 border-2 border-dashed border-border rounded-xl text-muted-foreground hover:text-secondary hover:border-secondary hover:bg-secondary/5 font-medium transition-all"
        >
          <Plus className="w-4 h-4" /> {t('onboarding.debts.addDebt')}
        </button>
      )}

      <div className="mt-8 text-center">
        <button onClick={onSkip} className="text-sm font-medium text-muted-foreground hover:text-foreground underline transition-colors">
          {t('onboarding.debts.noDebts')}
        </button>
      </div>

      <div className="flex p-4 mt-8 text-sm rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400">
        <AlertCircle className="w-4 h-4 mt-0.5 mr-3 shrink-0" />
        <div><strong>{t('onboarding.debts.noteLabel')}:</strong> {t('onboarding.debts.classificationNote')}</div>
      </div>
    </div>
  );
}
