import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Loader2, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { useAccounts } from '../hooks/useAccounts';
import { CardFields, EMPTY_CARD_FIELDS, cardFieldsError, cardSettingsPayload, type CardFieldsValue } from '../components/shared/CardFields';
import { useMoney } from './useMoney';

// Credit cards, exactly as in Accounts: a card is an account (type "card") and
// the server creates its debt and budget line behind it (server/lib/cardDebt.ts).
export function CardsStep() {
  const { t } = useTranslation();
  const { fmt } = useMoney();
  const { accounts, createAccount, deleteAccount } = useAccounts();
  const cards = accounts.filter(a => a.type === 'card' && !a.isArchived);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [fields, setFields] = useState<CardFieldsValue>(EMPTY_CARD_FIELDS);
  const [saving, setSaving] = useState(false);

  const reset = () => { setAdding(false); setName(''); setFields(EMPTY_CARD_FIELDS); };

  const handleSave = async () => {
    if (!name.trim()) { toast.error(t('accounts.nameRequired')); return; }
    const cardError = cardFieldsError(fields);
    if (cardError) { toast.error(t(cardError)); return; }
    setSaving(true);
    const result = await createAccount({
      name: name.trim(),
      type: 'card',
      currentBalance: parseFloat(fields.currentBalance) || 0, // for a card: what's owed now
      ...cardSettingsPayload(fields),
    });
    setSaving(false);
    if ('error' in result) { toast.error(result.error as string); return; }
    toast.success(t('onboarding.cards.createdOk'));
    reset();
  };

  const handleDelete = async (id: string) => {
    const result = await deleteAccount(id);
    if (result.error) toast.error(result.code === 'account_backs_debt' ? t('accounts.backsDebtError') : result.error);
  };

  return (
    <div>
      <div className="space-y-3 mb-4">
        {cards.map(a => (
          <div key={a.id} className="bg-card p-5 rounded-2xl border border-border flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <CreditCard className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display truncate">{a.name}</p>
              {a.card && <p className="text-xs text-muted-foreground">{t(`debts.paymentMode.${a.card.paymentMode}`)}</p>}
            </div>
            <div className="text-right shrink-0">
              <p className={`font-display ${a.card && a.card.owed > 0 ? 'text-red-500' : ''}`}>{fmt(a.card?.owed ?? 0)}</p>
              <p className="text-xs text-muted-foreground">{t('accounts.cardOwed')}</p>
            </div>
            <button onClick={() => handleDelete(a.id)} className="p-2 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/5 transition-colors" title={t('accounts.delete')}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="bg-card p-6 rounded-2xl border border-border space-y-5">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">{t('onboarding.cards.nameLabel')}</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('onboarding.cards.namePlaceholder')}
              className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
            />
          </div>
          <CardFields value={fields} onChange={patch => setFields(f => ({ ...f, ...patch }))} />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('onboarding.cards.save')}
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
          <Plus className="w-4 h-4" /> {t('onboarding.cards.add')}
        </button>
      )}

      {cards.length === 0 && !adding && (
        <p className="mt-6 text-center text-sm text-muted-foreground">{t('onboarding.cards.noCards')}</p>
      )}
    </div>
  );
}
