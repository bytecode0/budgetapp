import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Landmark, Link2, RefreshCw, AlertTriangle, Trash2, ListChecks, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { useBanking, type BankAccount, type BankConnection, type LinkMapping } from '../../hooks/useBanking';
import type { Account } from '../../hooks/useAccounts';
import { consentExpired, daysLeft as daysLeftAt, needsReconnect } from '../../../../shared/bankStrip';
import { BankReview, type BankReviewTarget } from './BankReview';
import { BankPicker } from './BankPicker';
import { BankStatusRetry } from './BankStatusRetry';
import { useBankActions } from './useBankActions';

interface BankConnectionsProps {
  accounts: Account[];
  /** The post-consent hand-off token (?bankToken=). */
  pendingBankToken?: string | null;
  onConsumedBankToken?: () => void;
  /** The flow that began with pendingBankToken is over (linked and reviewed,
   *  renewed, cancelled or failed). */
  onBankFlowDone?: () => void;
  /** Accounts, balances or movements changed. */
  onChanged: () => void;
}

/** "Connect your bank" in Accounts (§5.6): hidden entirely unless the server
 *  says this user may use it. */
export function BankConnections({ accounts, pendingBankToken, onConsumedBankToken, onBankFlowDone, onChanged }: BankConnectionsProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { user } = useAuth();
  const banking = useBanking();
  const { enabled, connections } = banking;
  const { connecting, startConsent, syncingId, sync, fail } = useBankActions(banking, onChanged);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [mapping, setMapping] = useState<{ connectionId: string; institutionName: string; accounts: BankAccount[] } | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({}); // bank account id → 'new' | 'skip' | local account id
  const [linking, setLinking] = useState(false);
  const [review, setReview] = useState<BankReviewTarget[] | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<BankConnection | null>(null);
  // True while the post-consent flow (mapping, then the first review) runs.
  const tokenFlow = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const endTokenFlow = () => {
    if (!tokenFlow.current) return;
    tokenFlow.current = false;
    // The user may have left Accounts while the exchange was in flight: then
    // they chose where to be, and nothing moves them.
    if (mounted.current) onBankFlowDone?.();
  };

  const openMapping = (connectionId: string, institutionName: string, bankAccounts: BankAccount[]) => {
    setMapping({ connectionId, institutionName, accounts: bankAccounts });
    // Once some are linked, the others were skipped on purpose: keep them so.
    const anyLinked = bankAccounts.some(a => a.linkedAccountId);
    setChoices(Object.fromEntries(bankAccounts.map(a => [a.id, a.linkedAccountId ?? (anyLinked ? 'skip' : 'new')])));
  };

  // Back from the bank: resolve the hand-off, then link the accounts — unless
  // a renewed consent already re-linked every one of them.
  useEffect(() => {
    if (!pendingBankToken || !enabled) return;
    tokenFlow.current = true;
    banking.exchange(pendingBankToken).then(res => {
      onConsumedBankToken?.();
      banking.fetchConnections();
      if (!res.ok) { fail(res, 'banking.errors.failed'); endTokenFlow(); return; }
      if (res.accounts.length > 0 && res.accounts.every(a => a.linkedAccountId)) {
        toast.success(t('banking.renewedOk', { bank: res.institutionName }));
        endTokenFlow();
        return;
      }
      openMapping(res.connectionId, res.institutionName, res.accounts);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBankToken, enabled]);

  // Couldn't ask the server: a retry, not silence. Not available: nothing.
  if (banking.availability === 'check_failed') {
    return <BankStatusRetry onRetry={banking.checkStatus} />;
  }
  if (!enabled) return null;

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const daysLeft = (iso: string) => daysLeftAt(iso, new Date());

  const openLinking = async (c: BankConnection) => {
    setBusyId(c.id);
    const res = await banking.bankAccounts(c.id);
    setBusyId(null);
    if (!res.ok) { fail(res, 'banking.errors.failed'); return; }
    openMapping(c.id, c.institutionName, res.accounts);
  };

  const handleLink = async () => {
    if (!mapping) return;
    const mappings: LinkMapping[] = mapping.accounts.flatMap((a): LinkMapping[] => {
      const choice = choices[a.id] ?? 'skip';
      if (choice === 'skip') return [];
      if (choice === 'new') {
        return [{ externalAccountId: a.id, create: { name: a.name || mapping.institutionName, type: a.kind } }];
      }
      return [{ externalAccountId: a.id, accountId: choice }];
    });
    if (mappings.length === 0) { setMapping(null); endTokenFlow(); return; }
    setLinking(true);
    const res = await banking.linkAccounts(mapping.connectionId, mappings);
    setLinking(false);
    if (!res.ok) { fail(res, 'banking.errors.linkFailed'); return; }
    toast.success(t('banking.linkedOk', { count: res.linked }));
    onChanged();
    const connectionId = mapping.connectionId;
    setMapping(null);
    // Straight into the first review: nothing is imported until it's done.
    // accountIds come back in the order of the mappings sent.
    const first = res.accountIds[0];
    const firstMapping = mappings[0];
    const name = firstMapping.create?.name ?? accounts.find(a => a.id === firstMapping.accountId)?.name ?? mapping.institutionName;
    if (first) setReview([{ connectionId, accountId: first, accountName: name, firstTime: true }]);
    else endTokenFlow();
  };

  const handleDisconnect = async (c: BankConnection) => {
    setBusyId(c.id);
    const res = await banking.disconnect(c.id);
    setBusyId(null);
    setConfirmDisconnect(null);
    if (!res.ok) { fail(res, 'banking.errors.failed'); return; }
    onChanged();
    toast.success(t('banking.disconnectedOk', { bank: c.institutionName }));
  };

  const statusLine = (c: BankConnection) => {
    if (c.status === 'pending') return t('banking.statusPending');
    if (consentExpired(c, new Date())) return t('banking.statusExpired');
    if (c.status === 'error') return t('banking.statusError');
    return c.lastSyncedAt ? t('banking.statusSynced', { date: fmtDate(c.lastSyncedAt) }) : t('banking.statusNotSynced');
  };

  // Compatible accounts of mine for a bank account: a card to a card.
  const targetsFor = (a: BankAccount) => accounts.filter(acc =>
    !acc.isArchived && acc.ownerUserId === user?.id && (acc.type === 'card') === (a.kind === 'card'));

  const visible = connections.filter(c => c.status !== 'pending' || c.isOwner);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.07 }} className="space-y-3">
      {visible.map(c => {
        const left = c.expiresAt ? daysLeft(c.expiresAt) : null;
        const expired = consentExpired(c, new Date());
        const reconnect = needsReconnect(c, new Date());
        const busy = busyId === c.id || syncingId === c.id;
        return (
          <div key={c.id} className="bg-card border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Link2 className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="font-display truncate">{c.institutionName}</p>
                  <p className={`text-xs ${c.status === 'active' && !expired ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>{statusLine(c)}</p>
                  {c.expiresAt && c.status === 'active' && !reconnect && (
                    <p className="text-xs text-muted-foreground">{t('banking.consentUntil', { date: fmtDate(c.expiresAt) })}</p>
                  )}
                  {!c.isOwner && <p className="text-xs text-muted-foreground">{t('banking.sharedReadOnly')}</p>}
                </div>
              </div>
              {c.isOwner && (
                <div className="flex items-center gap-1 shrink-0">
                  {(c.status === 'active' || c.status === 'error') && (
                    <button onClick={() => sync(c.id)} disabled={busy} className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50" title={t('banking.syncNow')}>
                      <RefreshCw className={`w-4 h-4 text-muted-foreground ${busy ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  <button onClick={() => setConfirmDisconnect(c)} disabled={busy} className="p-2 rounded-lg border border-destructive/20 text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-50" title={t('banking.disconnect')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {reconnect && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex items-center justify-between gap-3">
                <div className="flex gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm">
                    {expired ? t('banking.expiredWarning') : t('banking.expiringWarning', { count: Math.max(left ?? 0, 0), date: fmtDate(c.expiresAt!) })}
                  </p>
                </div>
                {c.isOwner && (
                  <button onClick={() => startConsent({ connectionId: c.id })} disabled={connecting} className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-display hover:bg-amber-500/20 transition-colors shrink-0 disabled:opacity-50">
                    {t('banking.reconnect')}
                  </button>
                )}
              </div>
            )}
            {c.isOwner && (c.status === 'error' || c.status === 'pending') && (
              <button onClick={() => startConsent({ connectionId: c.id })} disabled={connecting} className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm disabled:opacity-50">
                {t('banking.reconnect')}
              </button>
            )}

            {c.accounts.length > 0 && (
              <div className="space-y-2">
                {c.accounts.map(a => (
                  <div key={a.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      {a.type === 'card' ? <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" /> : <Landmark className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <span className="truncate">{a.name}</span>
                    </span>
                    {c.isOwner && !expired && (!a.bankReviewedAt || a.bankPendingReview > 0) && (
                      <button
                        onClick={() => setReview([{ connectionId: c.id, accountId: a.id, accountName: a.name, firstTime: !a.bankReviewedAt }])}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-display hover:bg-primary/20 transition-colors shrink-0"
                      >
                        <ListChecks className="w-3.5 h-3.5" />
                        {a.bankReviewedAt ? t('banking.toReview', { count: a.bankPendingReview }) : t('banking.reviewFirst')}
                      </button>
                    )}
                  </div>
                  {c.isOwner && a.bankSyncNotice === 'held_expired' && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      {t('banking.heldExpired')}
                    </p>
                  )}
                  </div>
                ))}
              </div>
            )}
            {c.isOwner && c.status === 'active' && (
              <button onClick={() => openLinking(c)} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                {c.accounts.length === 0 ? t('banking.linkAccounts') : t('banking.changeLinks')}
              </button>
            )}
          </div>
        );
      })}

      <button
        onClick={() => setShowPicker(true)}
        className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-border rounded-2xl text-sm text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
      >
        <Link2 className="w-4 h-4" />
        {t('banking.connectBank')}
      </button>

      <BankPicker
        open={showPicker}
        onClose={() => setShowPicker(false)}
        fetchInstitutions={banking.fetchInstitutions}
        connecting={connecting}
        onChoose={startConsent}
      />

      {/* ── Link bank accounts to accounts ── */}
      <AnimatePresence>
        {mapping && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget && !linking) { setMapping(null); endTokenFlow(); } }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-display">{t('banking.mapTitle')}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{t('banking.mapSubtitle', { bank: mapping.institutionName })}</p>
                </div>
                <button onClick={() => { setMapping(null); endTokenFlow(); }} disabled={linking} aria-label={t('banking.close')} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {mapping.accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t('banking.mapNone')}</p>
              ) : (
                <div className="space-y-4">
                  {mapping.accounts.map(a => (
                    <div key={a.id} className="space-y-1.5">
                      <p className="text-sm font-display truncate flex items-center gap-2">
                        {a.kind === 'card' ? <CreditCard className="w-4 h-4 text-muted-foreground" /> : <Landmark className="w-4 h-4 text-muted-foreground" />}
                        {a.name || mapping.institutionName}
                        {a.ibanLast4 && <span className="text-xs text-muted-foreground">··{a.ibanLast4}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{t(`banking.kind.${a.kind}`)}</p>
                      <select
                        value={choices[a.id] ?? 'new'}
                        onChange={e => setChoices(c => ({ ...c, [a.id]: e.target.value }))}
                        className="w-full border border-border rounded-xl px-4 py-2.5 bg-background outline-none focus:border-primary text-sm"
                      >
                        <option value="new">{t(a.kind === 'card' ? 'banking.mapNewCard' : 'banking.mapNewAccount')}</option>
                        {targetsFor(a).map(acc => (
                          <option key={acc.id} value={acc.id}>{t('banking.mapExisting', { name: acc.name })}</option>
                        ))}
                        <option value="skip">{t('banking.mapSkip')}</option>
                      </select>
                    </div>
                  ))}
                  {mapping.accounts.some(a => a.kind === 'card') && (
                    <p className="text-xs text-muted-foreground">{t('banking.mapCardHint')}</p>
                  )}
                </div>
              )}
              <button
                onClick={handleLink}
                disabled={linking}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {linking && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('banking.mapConfirm')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Disconnect ── */}
      <AnimatePresence>
        {confirmDisconnect && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setConfirmDisconnect(null); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 40, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-display">{t('banking.disconnectTitle', { bank: confirmDisconnect.institutionName })}</h2>
                <button onClick={() => setConfirmDisconnect(null)} aria-label={t('banking.close')} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">{t('banking.disconnectDesc')}</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDisconnect(null)} className="flex-1 px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm">
                  {t('banking.cancel')}
                </button>
                <button
                  onClick={() => handleDisconnect(confirmDisconnect)}
                  disabled={busyId === confirmDisconnect.id}
                  className="flex-1 px-5 py-2.5 border border-destructive/20 text-destructive hover:bg-destructive/5 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {busyId === confirmDisconnect.id && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t('banking.disconnect')}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BankReview
        queue={review}
        onClose={() => { setReview(null); endTokenFlow(); }}
        onDone={() => { onChanged(); banking.fetchConnections(); }}
        preview={banking.preview}
        confirm={banking.confirm}
      />
    </motion.div>
  );
}
