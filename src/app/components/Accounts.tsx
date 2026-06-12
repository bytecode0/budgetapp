import { useState, useRef, useCallback, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, X, GripVertical, Pencil, Trash2, Archive, ArchiveRestore,
  Landmark, PiggyBank, Wallet, TrendingUp, CreditCard, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useAccounts, type Account, type AccountType } from '../hooks/useAccounts';

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
  children: (handleRef: React.RefObject<HTMLDivElement | null>) => React.ReactNode;
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

interface FormState {
  id: string | null;
  name: string;
  type: AccountType;
  currentBalance: string;
}

const EMPTY_FORM: FormState = { id: null, name: '', type: 'checking', currentBalance: '' };

export function Accounts() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { accounts, netWorth, loading, createAccount, updateAccount, deleteAccount, reorderAccounts } = useAccounts();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Local copy for drag reordering of active accounts.
  const [local, setLocal] = useState<Account[]>([]);
  useEffect(() => { setLocal(accounts); }, [accounts]);

  const localRef = useRef(local);
  localRef.current = local;

  const active = local.filter(a => !a.isArchived);
  const archived = local.filter(a => a.isArchived);

  const fmtEuro = (v: number) =>
    `€${v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

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
    setForm({ id: a.id, name: a.name, type: a.type, currentBalance: String(a.currentBalance) });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) { toast.error(t('accounts.nameRequired')); return; }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      type: form.type,
      currentBalance: parseFloat(form.currentBalance) || 0,
    };
    const result = form.id
      ? await updateAccount(form.id, payload)
      : await createAccount(payload);
    setSaving(false);
    if (result.error) { toast.error(result.error); return; }
    toast.success(form.id ? t('accounts.savedOk') : t('accounts.createdOk'));
    setShowForm(false);
    setForm(EMPTY_FORM);
  };

  const handleArchive = async (a: Account) => {
    const result = await updateAccount(a.id, { isArchived: !a.isArchived });
    if (result.error) toast.error(result.error);
    else toast.success(a.isArchived ? t('accounts.restoredOk') : t('accounts.archivedOk'));
  };

  const handleDelete = async (a: Account) => {
    const result = await deleteAccount(a.id);
    if (result.error) toast.error(result.error);
    else toast.success(t('accounts.deletedOk'));
  };

  const renderRow = (a: Account, handleRef?: React.RefObject<HTMLDivElement | null>) => {
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
          <p className="text-xs text-muted-foreground">{t(`accounts.type.${a.type}`)}</p>
        </div>
        <p className={`text-lg font-display shrink-0 ${a.currentBalance < 0 ? 'text-red-500' : ''}`}>
          {fmtEuro(a.currentBalance)}
        </p>
        <div className="flex items-center gap-1 shrink-0">
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

              {/* Current balance */}
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">{t('accounts.balanceLabel')}</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">€</span>
                  <input
                    type="number"
                    value={form.currentBalance}
                    onChange={e => setForm(f => ({ ...f, currentBalance: e.target.value }))}
                    placeholder="0"
                    className="w-full pl-8 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
                  />
                </div>
              </div>

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
    </div>
  );
}
