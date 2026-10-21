import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { useAccounts } from '../../hooks/useAccounts';
import { recordDebtPayment } from '../../lib/debtPayments';

export interface DebtPaymentTarget {
  debtId: string;
  name: string;
  owed: number;                 // euros — live balance, shown for context
  suggested: number;            // euros — prefilled amount (whole balance for a card)
  cardAccountId: string | null; // a card can't be paid from itself
}

// The user's local calendar day (toISOString would be UTC: yesterday in Spain
// between midnight and 2am, landing a payment in the previous period).
const today = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

// Pay a card or a loan cuota, partially or in full, from a bank account.
// Shared by Activity, Accounts and Debts. Open by passing a `target`; with
// `choices`, the user can switch which card/debt to pay (Activity's
// "Pagar tarjeta" opens on the first card).
export function DebtPaymentSheet({
  target, choices, onClose, onPaid,
}: {
  target: DebtPaymentTarget | null;
  choices?: DebtPaymentTarget[];
  onClose: () => void;
  onPaid?: () => void;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const currency = t('currency.symbol');
  const { accounts } = useAccounts();

  const [current, setCurrent] = useState<DebtPaymentTarget | null>(target);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(today());
  const [saving, setSaving] = useState(false);

  const payFrom = accounts.filter(a => !a.isArchived && a.type !== 'card' && a.id !== current?.cardAccountId);

  useEffect(() => {
    setCurrent(target);
    setAmount(target && target.suggested > 0 ? String(target.suggested) : '');
    setDate(today());
  }, [target]);

  useEffect(() => {
    if (!payFrom.some(a => a.id === accountId)) setAccountId(payFrom[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, current]);

  const choose = (debtId: string) => {
    const next = choices?.find(c => c.debtId === debtId) ?? null;
    setCurrent(next);
    setAmount(next && next.suggested > 0 ? String(next.suggested) : '');
  };

  const fmt = (v: number) => `${currency}${v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const handlePay = async () => {
    const value = parseFloat(amount);
    if (!current || !value || value <= 0 || !accountId) return;
    setSaving(true);
    const result = await recordDebtPayment({ id: current.debtId, name: current.name }, {
      amount: value, accountId, date,
      description: t('debts.paymentDescription', { name: current.name }),
    });
    setSaving(false);
    if (result.code) {
      toast.error(t(result.code === 'paid_from_card' ? 'debts.paidFromCardError' : 'debts.paymentFailed'));
      return;
    }
    toast.success(t('debts.paidOk'));
    onPaid?.();
    onClose();
  };

  const open = target !== null;

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-display">{t('debts.payTitle')}</h2>
                <p className="text-sm text-muted-foreground">{current.name} · {t('debts.owedNow', { amount: fmt(Math.max(0, current.owed)) })}</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {choices && choices.length > 1 && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('debts.payWhichLabel')}</label>
                <select
                  value={current.debtId}
                  onChange={e => choose(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                >
                  {choices.map(c => <option key={c.debtId} value={c.debtId}>{c.name}</option>)}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('debts.payAmountLabel')}</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">{currency}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('debts.payPartialHint')}</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('debts.payFromLabel')}</label>
              {payFrom.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-500">{t('debts.noPayFromAccount')}</p>
              ) : (
                <select
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                >
                  {payFrom.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">{t('debts.payDateLabel')}</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
              />
            </div>

            <button
              onClick={handlePay}
              disabled={saving || !accountId || !(parseFloat(amount) > 0)}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('debts.recordPayment')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
