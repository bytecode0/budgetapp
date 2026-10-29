import { useState, useRef, useCallback, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, X, GripVertical, Pencil, Trash2, Archive, ArchiveRestore,
  Landmark, PiggyBank, Wallet, TrendingUp, CreditCard, Loader2, Link2, RefreshCw, AlertTriangle,
  Banknote,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useAccounts, type Account, type AccountType } from '../hooks/useAccounts';
import { CardFields, EMPTY_CARD_FIELDS, cardFieldsError, cardSettingsPayload, type CardFieldsValue } from './shared/CardFields';
import { DebtPaymentSheet, type DebtPaymentTarget } from './shared/DebtPaymentSheet';
import { apiErrorMessage } from '../lib/apiErrors';
import { useHousehold } from '../hooks/useHousehold';
import { useBanking, type BankInstitution, type BankProviderAccount, type BankConnection as BankConnectionInfo } from '../hooks/useBanking';

const ACCOUNT_TYPES: AccountType[] = ['checking', 'savings', 'cash', 'investment', 'card'];

function typeIcon(type: AccountType) {
  switch (type) {
    case 'savings':    return PiggyBank;
    case 'cash':       return Wallet;
    case 'investment': return TrendingUp;
    case 'card':       return CreditCard;
    default:           return Landmark;
  }
}

const DRAG_TYPE = 'ACCOUNT_ROW';
interface DragItem { id: string; index: number }

function DraggableRow({
  id, index, moveRow, onDragEnd, children,
}: {
  id: string;
  index: number;
  moveRow: (from: number, to: number) => void;
  onDragEnd: () => void;
  children: (handleRef: React.RefObject<HTMLDivElement>) => React.ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>({
    type: DRAG_TYPE,
    item: () => ({ id, index }),
    collect: monitor => ({ isDragging: monitor.isDragging() }),
    end: () => onDragEnd(),
  });

  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>({
    accept: DRAG_TYPE,
    collect: monitor => ({ isOver: monitor.isOver() }),
    hover(draggedItem) {
      if (draggedItem.index === index) return;
      moveRow(draggedItem.index, index);
      draggedItem.index = index;
    },
  });

  drop(rowRef);
  drag(handleRef);

  return (
    <div
      ref={rowRef}
      className={`transition-opacity rounded-2xl ${isDragging ? 'opacity-40' : 'opacity-100'} ${isOver ? 'ring-2 ring-primary/20' : ''}`}
    >
      {children(handleRef)}
    </div>
  );
}

// For a card, currentBalance (from CardFieldsValue) is what's owed now.
interface FormState extends CardFieldsValue {
  id: string | null;
  name: string;
  type: AccountType;
  visibility: 'private' | 'household';
  // As loaded when editing: a card's owed amount is only sent if the user
  // changed it, so a form left open can't erase a purchase recorded meanwhile.
  loadedBalance: string;
  loadedType: AccountType | null;
}

const EMPTY_FORM: FormState = {
  ...EMPTY_CARD_FIELDS, id: null, name: '', type: 'checking', visibility: 'household', loadedBalance: '', loadedType: null,
};

export function Accounts({ pendingBankToken, onConsumedBankToken }: { pendingBankToken?: string | null; onConsumedBankToken?: () => void } = {}) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const currency = t('currency.symbol');
  const { accounts, netWorth, loading, createAccount, updateAccount, deleteAccount, reorderAccounts, fetchAccounts } = useAccounts();
  const { household } = useHousehold();
  const { user } = useAuth();
  const inHousehold = (household?.members?.length ?? 0) > 1;

  const { enabled: bankingEnabled, connections, connect, exchange, linkAccounts, fetchInstitutions, syncNow, reconnect } = useBanking();
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const handleSyncNow = async (connectionId: string) => {
    setSyncingId(connectionId);
    const result = await syncNow(connectionId);
    setSyncingId(null);
    if (result.error) toast.error(result.error);
    else toast.success(t('accounts.syncedOk', { expenses: result.expenses ?? 0, income: result.income ?? 0 }));
  };

  const handleReconnect = async (c: BankConnectionInfo) => {
    setConnecting(true);
    const result = await reconnect(c);
    if (result.error) { toast.error(result.error); setConnecting(false); }
  };

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Open Banking — institution picker
  const [showInstitutionPicker, setShowInstitutionPicker] = useState(false);
  const [institutions, setInstitutions] = useState<BankInstitution[]>([]);
  const [loadingInstitutions, setLoadingInstitutions] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Open Banking — post-consent account mapping
  const [mapping, setMapping] = useState<{ connectionId: string; institutionName: string; providerAccounts: BankProviderAccount[] } | null>(null);
  const [mappingChoices, setMappingChoices] = useState<Record<string, string>>({}); // externalAccountId -> 'new' | existing accountId
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    if (!pendingBankToken) return;
    exchange(pendingBankToken).then(result => {
      onConsumedBankToken?.();
      if (result.error) { toast.error(result.error); return; }
      if (result.connectionId && result.accounts) {
        setMapping({ connectionId: result.connectionId, institutionName: result.institutionName ?? '', providerAccounts: result.accounts });
        setMappingChoices(Object.fromEntries(result.accounts.map(a => [a.id, 'new'])));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBankToken]);

  const openInstitutionPicker = async () => {
    setShowInstitutionPicker(true);
    setLoadingInstitutions(true);
    const list = await fetchInstitutions('ES');
    setInstitutions(list);
    setLoadingInstitutions(false);
  };

  const handleConnect = async (inst: BankInstitution) => {
    setConnecting(true);
    const result = await connect(inst.id, inst.name);
    if (result.error) { toast.error(result.error); setConnecting(false); }
    // On success, connect() navigates the browser away — no further state update needed here.
  };

  const handleLinkAccounts = async () => {
    if (!mapping) return;
    setLinking(true);
    const result = await linkAccounts(
      mapping.connectionId,
      mapping.providerAccounts.map(a => {
        const choice = mappingChoices[a.id];
        return choice === 'new' || !choice
          ? { externalAccountId: a.id, create: { name: a.name || a.iban || t('accounts.bankAccountFallback'), type: 'checking' } }
          : { externalAccountId: a.id, accountId: choice };
      }),
    );
    setLinking(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(t('accounts.bankLinkedOk', { count: result.linked ?? 0 }));
    setMapping(null);
  };

  // Local copy for drag reordering of active accounts.
  const [local, setLocal] = useState<Account[]>([]);
  useEffect(() => { setLocal(accounts); }, [accounts]);

  const localRef = useRef(local);
  localRef.current = local;

  const active = local.filter(a => !a.isArchived);
  const archived = local.filter(a => a.isArchived);

  const fmtEuro = (v: number) =>
    `${currency}${v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  const moveRow = useCallback((from: number, to: number) => {
    setLocal(prev => {
      // map active-index → absolute index in `prev`
      const activeItems = prev.filter(a => !a.isArchived);
      const moved = activeItems[from];
      const target = activeItems[to];
      if (!moved || !target) return prev;
      const next = [...prev];
      const fromAbs = next.indexOf(moved);
      const toAbs = next.indexOf(target);
      next.splice(fromAbs, 1);
      next.splice(toAbs, 0, moved);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    const order = localRef.current
      .filter(a => !a.isArchived)
      .map((item, index) => ({ id: item.id, sortOrder: index }));
    reorderAccounts(order);
  }, [reorderAccounts]);

  const openCreate = () => { setForm(EMPTY_FORM); setShowForm(true); };
  const openEdit = (a: Account) => {
    const balance = String(a.card ? a.card.owed : a.currentBalance);
    setForm({
      id: a.id, name: a.name, type: a.type, currentBalance: balance, visibility: a.visibility ?? 'household',
      cardPaymentMode: a.card?.paymentMode ?? 'full',
      cardMinimumPayment: a.card?.minimumPayment != null ? String(a.card.minimumPayment) : '',
      cardPaymentDueDay: a.card?.paymentDueDay != null ? String(a.card.paymentDueDay) : '',
      loadedBalance: balance,
      loadedType: a.type,
    });
    setShowForm(true);
  };

  const isCard = form.type === 'card';
  const [paying, setPaying] = useState<DebtPaymentTarget | null>(null);
  const openPay = (a: Account) => a.card && setPaying({
    debtId: a.card.debtId, name: a.name, owed: a.card.owed, suggested: a.card.owed, cardAccountId: a.id,
  });

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error(t('accounts.nameRequired')); return; }
    const cardError = isCard ? cardFieldsError(form) : null;
    if (cardError) { toast.error(t(cardError)); return; }
    setSaving(true);
    // Turning an account into a card makes the field mean "owed" — send it.
    const balanceChanged = !form.id || form.currentBalance !== form.loadedBalance || form.type !== form.loadedType;
    const payload = {
      name: form.name.trim(),
      type: form.type,
      ...((!isCard || balanceChanged) && { currentBalance: parseFloat(form.currentBalance) || 0 }),
      visibility: form.visibility,
      ...(isCard && cardSettingsPayload(form)),
    };
    const result = form.id
      ? await updateAccount(form.id, payload)
      : await createAccount(payload);
    setSaving(false);
    if (result.error) {
      toast.error(apiErrorMessage(t, result));
      return;
    }
    toast.success(form.id ? t('accounts.savedOk') : t('accounts.createdOk'));
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const handleArchive = async (a: Account) => {
    const result = await updateAccount(a.id, { isArchived: !a.isArchived });
    if (result.error) toast.error(apiErrorMessage(t, result));
    else toast.success(a.isArchived ? t('accounts.restoredOk') : t('accounts.archivedOk'));
  };

  const handleDelete = async (a: Account) => {
    const result = await deleteAccount(a.id);
    if (result.error) toast.error(apiErrorMessage(t, result));
    else toast.success(t('accounts.deletedOk'));
  };

  const renderRow = (a: Account, handleRef?: React.RefObject<HTMLDivElement>) => {
    const Icon = typeIcon(a.type);
    return (
      <div className="bg-card border border-border rounded-2xl p-5 flex items-center gap-4">
        {handleRef && (
          <div
            ref={handleRef}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors shrink-0 touch-none select-none"
            title={t('accounts.dragToReorder')}
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center text-primary shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display truncate">{a.name}</p>
          <p className="text-xs text-muted-foreground">
            {t(`accounts.type.${a.type}`)}
            {a.card && ` · ${t(`debts.paymentMode.${a.card.paymentMode}`)}`}
          </p>
        </div>
        {a.card ? (
          <div className="text-right shrink-0">
            <p className={`text-lg font-display ${a.card.owed > 0 ? 'text-red-500' : ''}`}>{fmtEuro(a.card.owed)}</p>
            <p className="text-xs text-muted-foreground">{t('accounts.cardOwed')}</p>
          </div>
        ) : (
          <p className={`text-lg font-display shrink-0 ${a.currentBalance < 0 ? 'text-red-500' : ''}`}>
            {fmtEuro(a.currentBalance)}
          </p>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {a.card && !a.isArchived && (
            <button onClick={() => openPay(a)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={t('accounts.payCard')}>
              <Banknote className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
          {/* Another member's shared account is read-only (the server answers 403). */}
          {a.ownerUserId === user?.id && (
            <>
              <button onClick={() => openEdit(a)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={t('accounts.edit')}>
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
              <button onClick={() => handleArchive(a)} className="p-2 rounded-lg hover:bg-muted transition-colors" title={a.isArchived ? t('accounts.restore') : t('accounts.archive')}>
                {a.isArchived ? <ArchiveRestore className="w-4 h-4 text-muted-foreground" /> : <Archive className="w-4 h-4 text-muted-foreground" />}
              </button>
              {a.isArchived && (
                <button onClick={() => handleDelete(a)} className="p-2 rounded-lg border border-destructive/20 text-destructive hover:bg-destructive/5 transition-colors" title={t('accounts.delete')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-8">
      {/* ── Page title ── */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
        <h1 className="text-4xl tracking-tight">{t('accounts.title')}</h1>
        <p className="text-muted-foreground">{t('accounts.subtitle')}</p>
      </motion.div>

      {/* ── Net worth hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground rounded-3xl p-8 shadow-2xl relative overflow-hidden"
      >
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -mr-32 -mt-32" />
        <div className="relative z-10">
          <p className="text-sm opacity-75 mb-1">{t('accounts.netWorth')}</p>
          <p className="text-5xl font-display">{fmtEuro(netWorth)}</p>
          <p className="text-xs opacity-60 mt-2">{t('accounts.netWorthHint', { count: active.length })}</p>
        </div>
      </motion.div>

      {/* ── Open Banking: connect a bank + connection status ── */}
      {bankingEnabled && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="space-y-3">
          {connections.map(c => (
            <div key={c.id} className="flex items-center justify-between gap-3 bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Link2 className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-display truncate">{c.institutionName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.status === 'active' && t('accounts.bankStatusActive')}
                    {c.status === 'pending' && t('accounts.bankStatusPending')}
                    {(c.status === 'expired' || c.status === 'error') && t('accounts.bankStatusNeedsAttention')}
                  </p>
                </div>
              </div>
              {c.status === 'active' ? (
                <button
                  onClick={() => handleSyncNow(c.id)}
                  disabled={syncingId === c.id}
                  className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0 disabled:opacity-50"
                  title={t('accounts.syncNow')}
                >
                  <RefreshCw className={`w-4 h-4 text-muted-foreground ${syncingId === c.id ? 'animate-spin' : ''}`} />
                </button>
              ) : (
                <button
                  onClick={() => handleReconnect(c)}
                  disabled={connecting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-display hover:bg-amber-500/20 transition-colors shrink-0 disabled:opacity-50"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('accounts.reconnect')}
                </button>
              )}
            </div>
          ))}
          <button
            onClick={openInstitutionPicker}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-border rounded-2xl text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
          >
            <Link2 className="w-4 h-4" />
            {t('accounts.connectBank')}
          </button>
        </motion.div>
      )}

      {loading ? (
        <div className="bg-card border border-border rounded-2xl p-6 h-24 animate-pulse" />
      ) : active.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto">
            <Landmark className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="font-display text-lg">{t('accounts.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('accounts.emptyDesc')}</p>
        </div>
      ) : (
        <DndProvider backend={HTML5Backend}>
          <div className="space-y-3">
            {active.map((a, index) => (
              <DraggableRow key={a.id} id={a.id} index={index} moveRow={moveRow} onDragEnd={handleDragEnd}>
                {(handleRef) => renderRow(a, handleRef)}
              </DraggableRow>
            ))}
          </div>
        </DndProvider>
      )}

      {/* ── Archived ── */}
      {archived.length > 0 && (
        <div className="space-y-3">
          <button
            onClick={() => setShowArchived(v => !v)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showArchived ? t('accounts.hideArchived') : t('accounts.showArchived', { count: archived.length })}
          </button>
          <AnimatePresence>
            {showArchived && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="space-y-3 opacity-70"
              >
                {archived.map((a) => <div key={a.id}>{renderRow(a)}</div>)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── FAB ── */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.5, type: 'spring', stiffness: 200 }}
        onClick={openCreate}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        className="fixed right-6 bottom-6 w-16 h-16 bg-gradient-to-br from-primary to-secondary text-white rounded-full shadow-2xl hover:shadow-3xl transition-all flex items-center justify-center z-40 group"
      >
        <Plus className="w-7 h-7 group-hover:rotate-90 transition-transform" />
      </motion.button>

      {/* ── Create / edit modal ── */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{form.id ? t('accounts.editTitle') : t('accounts.newTitle')}</h2>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Name */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('accounts.nameLabel')}</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t('accounts.namePlaceholder')}
                  className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                />
              </div>

              {/* Type */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('accounts.typeLabel')}</label>
                <div className="grid grid-cols-3 gap-2">
                  {ACCOUNT_TYPES.map(tp => {
                    const Icon = typeIcon(tp);
                    const selected = form.type === tp;
                    return (
                      <button
                        key={tp}
                        onClick={() => setForm(f => ({ ...f, type: tp }))}
                        className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-colors text-xs ${selected ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted'}`}
                      >
                        <Icon className="w-4 h-4" />
                        {t(`accounts.type.${tp}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Card: how it's paid and what's owed — its debt is created and kept up to date on its own */}
              {isCard ? (
                <CardFields value={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} editing={!!form.id} />
              ) : (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('accounts.balanceLabel')}</label>
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
                </div>
              )}

              {/* Visibility (Epic H2) — only relevant inside a household */}
              {inHousehold && (
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">{t('accounts.visibilityLabel')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['household', 'private'] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setForm(f => ({ ...f, visibility: v }))}
                        className={`p-2.5 rounded-xl border-2 text-left transition-all ${
                          form.visibility === v ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                        }`}
                      >
                        <p className="text-sm font-medium">{t(`accounts.visibility_${v}`)}</p>
                        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{t(`accounts.visibility_${v}_desc`)}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {form.id ? t('accounts.save') : t('accounts.createAction')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DebtPaymentSheet target={paying} onClose={() => setPaying(null)} onPaid={fetchAccounts} />

      {/* ── Open Banking: institution picker ── */}
      <AnimatePresence>
        {showInstitutionPicker && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget && !connecting) setShowInstitutionPicker(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{t('accounts.chooseBankTitle')}</h2>
                <button onClick={() => setShowInstitutionPicker(false)} disabled={connecting} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {loadingInstitutions ? (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2">
                  {institutions.map(inst => (
                    <button
                      key={inst.id}
                      onClick={() => handleConnect(inst)}
                      disabled={connecting}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/40 hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
                    >
                      {inst.logo ? (
                        <img src={inst.logo} alt="" className="w-8 h-8 rounded-lg object-contain shrink-0" />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0"><Landmark className="w-4 h-4 text-muted-foreground" /></div>
                      )}
                      <span className="text-sm font-display truncate">{inst.name}</span>
                    </button>
                  ))}
                  {institutions.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('accounts.noInstitutions')}</p>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Open Banking: map provider accounts to local accounts ── */}
      <AnimatePresence>
        {mapping && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div>
                <h2 className="text-2xl font-display">{t('accounts.mapAccountsTitle')}</h2>
                <p className="text-sm text-muted-foreground mt-1">{t('accounts.mapAccountsSubtitle', { bank: mapping.institutionName })}</p>
              </div>
              <div className="space-y-3">
                {mapping.providerAccounts.map(pa => (
                  <div key={pa.id} className="space-y-1.5">
                    <p className="text-sm font-display truncate">{pa.name || pa.iban || pa.id}</p>
                    <select
                      value={mappingChoices[pa.id] ?? 'new'}
                      onChange={e => setMappingChoices(c => ({ ...c, [pa.id]: e.target.value }))}
                      className="w-full border border-border rounded-xl px-4 py-2.5 bg-background outline-none focus:border-primary text-sm"
                    >
                      <option value="new">{t('accounts.mapAsNew')}</option>
                      {accounts.filter(a => !a.isArchived).map(a => (
                        <option key={a.id} value={a.id}>{t('accounts.mapToExisting', { name: a.name })}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <button
                onClick={handleLinkAccounts}
                disabled={linking}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {linking && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('accounts.confirmLink')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
