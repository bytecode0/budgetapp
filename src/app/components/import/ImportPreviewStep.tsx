import { useState, useMemo } from 'react';
import { X, Loader2, Check, Sparkles, Columns3, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAllocations } from '../../hooks/useAllocations';
import { useImport, type ImportPreview, type ConfirmRow, type AiCategory, type PurchasesSign, type ImportSummary } from '../../hooks/useImport';
import { useMoney } from '../../onboarding/useMoney';
import { apiErrorMessage } from '../../lib/apiErrors';

type Row = ImportPreview['rows'][number];

interface ImportPreviewStepProps {
  data: ImportPreview;
  accountId: string | null;
  aiEnabled: boolean;
  /** Re-reads the preview with the card sign the user chose. */
  onSignChange: (sign: PurchasesSign) => void;
  signLoading: boolean;
  /** Tabular files: open the manual mapping when the columns came out wrong. */
  onMapByHand?: () => void;
  onConfirmed: (summary: ImportSummary) => void;
  /** Writes the kept rows somewhere else than a file import (the bank review,
   *  /api/banking/connections/:id/confirm), with the new rows NOT kept. Then
   *  keeping nothing is a valid answer. Default: useImport().confirm. */
  onConfirm?: (rows: ConfirmRow[], dismissed: string[]) => Promise<{ error: string; code?: string } | { inserted: number; summary: ImportSummary }>;
}

/** Skipped-row reason codes (shared/ingest/columns.ts: "state:PENDING"…) → text. */
function useSkippedReason() {
  const { t } = useTranslation();
  return (reason: string) => {
    if (reason.startsWith('state:')) return t('import.skippedState', { state: reason.slice('state:'.length) });
    return t('import.skippedOther');
  };
}

// The preview of the import wizard (4.6): what each row is, duplicates, card
// payments, rows to review, the card sign choice, warnings and the rows the
// file lists but aren't movements yet. Mounted once per preview response, so
// its selection starts from what the server suggested.
export function ImportPreviewStep({ data, accountId, aiEnabled, onSignChange, signLoading, onMapByHand, onConfirmed, onConfirm }: ImportPreviewStepProps) {
  const { t } = useTranslation();
  const { currency, locale } = useMoney();
  const { allocations, createAllocation } = useAllocations();
  const { confirming: importConfirming, classifying, suggestingCats, confirm, classify, suggestCategories } = useImport();
  const [overrideConfirming, setOverrideConfirming] = useState(false);
  const confirming = importConfirming || overrideConfirming;
  const skippedReason = useSkippedReason();

  // Default: every new row selected — except possible duplicates, rows in
  // another currency and card credits to review, which the user confirms one
  // by one; and nothing while a card file's sign is unknown.
  const [selected, setSelected] = useState<Set<string>>(() => (data.purchasesSign === 'unknown' ? new Set() : new Set(data.rows
    .filter(r => r.status === 'new' && r.kind !== 'needs_review' && !r.possibleDuplicate && !r.warnings?.includes('currency_mismatch'))
    .map(r => r.externalId))));
  // The suggested category per row. (A payment's suggestion is its debt line:
  // never prefilled as a category, or turning the payment into an expense
  // would still pay the debt.)
  const [allocByRow, setAllocByRow] = useState<Record<string, string>>(() => Object.fromEntries(data.rows
    .filter(r => r.suggestedAllocationId && r.kind !== 'payment').map(r => [r.externalId, r.suggestedAllocationId!])));
  // needs_review rows: what the user says the card credit is.
  const [resolution, setResolution] = useState<Record<string, 'payment' | 'refund'>>({});
  // Bank rows that may pay a debt: the debt chosen, '' = not a payment (an
  // expense). A payment proposed only by a learned rule starts unchecked
  // unless its amount is the debt's instalment (server/lib/ingest/learnedPayments.ts);
  // a card payment whose card couldn't be told, or a charge that only may be
  // one, starts as an expense until the user picks the card.
  const [payTarget, setPayTarget] = useState<Record<string, string>>(() => Object.fromEntries(data.rows
    .filter(r => data.mode !== 'card' && (r.kind === 'payment' || r.warnings?.includes('card_payment_unassigned') || r.warnings?.includes('possible_card_payment')))
    .map(r => [r.externalId, r.kind !== 'payment' || (r.learnedPayment && !r.learnedPayment.preselect) ? '' : r.debtId ?? ''])));
  const [aiMerchants, setAiMerchants] = useState<Set<string>>(new Set());
  const [proposedCats, setProposedCats] = useState<AiCategory[] | null>(null);
  const [acceptedCats, setAcceptedCats] = useState<Set<number>>(new Set());
  const [creatingCats, setCreatingCats] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);

  const fmtEuro = (v: number) => `${currency}${Math.abs(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  // Group new expense rows by merchant so the user can categorize a whole shop at
  // once instead of row by row. Sorted by frequency (most movements first).
  const merchantGroups = useMemo(() => {
    const map = new Map<string, { merchant: string; label: string; ids: string[] }>();
    data.rows
      .filter(r => r.status === 'new' && r.kind === 'expense')
      .forEach(r => {
        const g = map.get(r.merchant) ?? { merchant: r.merchant, label: r.merchant || r.description, ids: [] };
        g.ids.push(r.externalId);
        map.set(r.merchant, g);
      });
    return [...map.values()].sort((a, b) => b.ids.length - a.ids.length);
  }, [data]);

  const uncategorizedMerchantCount = merchantGroups.filter(g => g.ids.some(id => !allocByRow[id])).length;

  const assignMerchant = (ids: string[], allocationId: string) =>
    setAllocByRow(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, allocationId])) }));

  const uncategorizedMerchants = () =>
    merchantGroups.filter(g => g.ids.some(id => !allocByRow[id]) && g.merchant).map(g => g.merchant);

  // Classify the given merchants against existing categories and merge into the
  // preview. Editable afterwards; degrades to a toast on failure.
  const runClassify = async (merchants: string[]) => {
    if (merchants.length === 0) return;
    const res = await classify(merchants);
    if (res.error) { toast.error(t('import.aiFailed')); return; }
    const suggestions = res.suggestions ?? [];
    if (suggestions.length === 0) { toast.info(t('import.aiNoneFound')); return; }
    const idsByMerchant = new Map(merchantGroups.map(g => [g.merchant, g.ids]));
    setAllocByRow(prev => {
      const next = { ...prev };
      for (const s of suggestions) {
        for (const id of idsByMerchant.get(s.merchant) ?? []) next[id] = s.allocationId;
      }
      return next;
    });
    setAiMerchants(prev => new Set([...prev, ...suggestions.map(s => s.merchant)]));
    toast.success(t('import.aiClassified', { count: suggestions.length }));
  };

  const handleClassifyAI = () => runClassify(uncategorizedMerchants());

  // Ask the AI to propose a category set from the uncategorized merchants.
  const handleSuggestCategories = async () => {
    const merchants = uncategorizedMerchants();
    if (merchants.length === 0) return;
    const res = await suggestCategories(merchants);
    if (res.error) { toast.error(t('import.aiFailed')); return; }
    const cats = res.categories ?? [];
    if (cats.length === 0) { toast.info(t('import.aiNoneFound')); return; }
    setProposedCats(cats);
    setAcceptedCats(new Set(cats.map((_, i) => i))); // accept all by default
  };

  // Create the accepted categories, then re-classify so the new ones get assigned.
  const handleCreateCategories = async () => {
    if (!proposedCats) return;
    const chosen = proposedCats.filter((_, i) => acceptedCats.has(i));
    if (chosen.length === 0) { setProposedCats(null); return; }
    setCreatingCats(true);
    let created = 0;
    for (const cat of chosen) {
      const r = await createAllocation({ name: cat.name, icon: cat.icon, type: 'flexible' });
      if (!('error' in r)) created++;
    }
    setCreatingCats(false);
    setProposedCats(null);
    if (created > 0) {
      toast.success(t('import.aiCategoriesCreated', { count: created }));
      await runClassify(uncategorizedMerchants()); // assign merchants to the new categories
    }
  };

  const resolve = (id: string, kind: 'payment' | 'refund') => {
    setResolution(prev => ({ ...prev, [id]: kind }));
    setSelected(prev => new Set(prev).add(id));
  };

  // Rows whose debt the user picks: bank-side payments.
  const hasPayTarget = (r: Row) => r.externalId in payTarget;

  // The kind a row is imported as: a review row only once resolved; a bank
  // payment only while a debt is picked for it.
  const confirmKindOf = (r: Row): ConfirmRow['kind'] | null => {
    if (r.kind === 'needs_review') return resolution[r.externalId] ?? null;
    if (hasPayTarget(r)) return payTarget[r.externalId] ? 'payment' : 'expense';
    return r.kind;
  };
  const debtIdOf = (r: Row) => (hasPayTarget(r) ? payTarget[r.externalId] || null : r.debtId ?? null);

  // The stored movement a row may repeat. A debt the user picked other than
  // the one the preview proposed is re-checked against the stored payments of
  // that debt (same amount, nearby) the preview returned.
  const possibleDuplicateOf = (r: Row) => {
    const target = hasPayTarget(r) ? payTarget[r.externalId] : '';
    if (target && target !== r.debtId) return r.storedPayments?.find(s => s.debtId === target);
    return r.possibleDuplicate;
  };

  const changePayTarget = (r: Row, debtId: string) => {
    setPayTarget(prev => ({ ...prev, [r.externalId]: debtId }));
    // Paying a debt that already has this payment: unchecked, as every
    // possible duplicate starts in the preview; the user may re-check it.
    if (debtId && debtId !== r.debtId && r.storedPayments?.some(s => s.debtId === debtId)) {
      setSelected(prev => { const next = new Set(prev); next.delete(r.externalId); return next; });
    }
  };

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const signUnknown = data.purchasesSign === 'unknown';

  const handleConfirm = async () => {
    if (signUnknown) return;
    const rows: ConfirmRow[] = data.rows
      .filter(r => r.status === 'new' && selected.has(r.externalId))
      .flatMap(r => {
        const kind = confirmKindOf(r);
        if (!kind) return [];
        return [{
          kind,
          externalId: r.externalId,
          date: r.date,
          description: r.description,
          merchant: r.merchant,
          amount: r.amount,
          allocationId: kind === 'expense' || kind === 'refund' ? (allocByRow[r.externalId] || null) : undefined,
          debtId: kind === 'payment' ? debtIdOf(r) : undefined,
        }];
      });
    if (rows.length === 0 && !onConfirm) { toast.error(t('import.nothingSelected')); return; }
    let res;
    if (onConfirm) {
      const kept = new Set(rows.map(r => r.externalId));
      const dismissed = data.rows.filter(r => r.status === 'new' && !kept.has(r.externalId)).map(r => r.externalId);
      setOverrideConfirming(true);
      try { res = await onConfirm(rows, dismissed); } finally { setOverrideConfirming(false); }
    } else {
      res = await confirm(accountId, rows);
    }
    if ('error' in res) { toast.error(apiErrorMessage(t, { code: res.code, error: t('import.confirmFailed') })); return; }
    onConfirmed(res.summary);
  };

  const selectedCount = !signUnknown ? data.rows.filter(r => r.status === 'new' && selected.has(r.externalId) && confirmKindOf(r)).length : 0;
  const skipped = data.skipped ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary">{t('import.newCount', { count: data.newCount })}</span>
        <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.dupCount', { count: data.duplicateCount })}</span>
        <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.expenseCount', { count: data.expenseCount })}</span>
        <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('import.incomeCount', { count: data.incomeCount })}</span>
        {!!data.paymentCount && (
          <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.paymentCount', { count: data.paymentCount })}</span>
        )}
        {!!data.reviewCount && (
          <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">{t('import.reviewCount', { count: data.reviewCount })}</span>
        )}
        {skipped.length > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.skippedCount', { count: skipped.length })}</span>
        )}
      </div>

      {onMapByHand && (
        <button type="button" onClick={onMapByHand} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <Columns3 className="w-3.5 h-3.5" /> {t('import.wrongColumns')}
        </button>
      )}

      {/* Card files: how the statement writes purchases. Asked when it can't
          be told; always changeable (a wrong sign turns every purchase into a
          payment). The choice is saved on the account for its next file. */}
      {data.mode === 'card' && data.purchasesSign && (
        <div className={`rounded-xl p-3 space-y-2 ${signUnknown ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'border border-border'}`}>
          <p className="text-sm">{t(signUnknown ? 'import.signUnknown' : 'import.signQuestion')}</p>
          <div className="flex flex-wrap gap-2">
            {(['negative', 'positive'] as const).map(sign => (
              <button
                key={sign}
                type="button"
                disabled={signLoading}
                onClick={() => onSignChange(sign)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${data.purchasesSign === sign ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
              >
                {t(sign === 'negative' ? 'import.signNegative' : 'import.signPositive')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Rows the file lists that aren't movements yet (pending, declined…). */}
      {skipped.length > 0 && (
        <div className="border border-border rounded-xl p-3 space-y-2">
          <button type="button" onClick={() => setShowSkipped(v => !v)} className="w-full flex items-center justify-between gap-2 text-left">
            <span className="text-sm flex items-center gap-2"><EyeOff className="w-4 h-4 text-muted-foreground" /> {t('import.skippedTitle', { count: skipped.length })}</span>
            <span className="text-xs text-primary">{showSkipped ? t('import.hide') : t('import.show')}</span>
          </button>
          {showSkipped && (
            <ul className="space-y-1 max-h-32 overflow-y-auto">
              {skipped.map(s => (
                <li key={s.rowIndex} className="text-xs text-muted-foreground">
                  {t('import.skippedRow', { row: s.rowIndex + 1, reason: skippedReason(s.reason) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Bulk assign by merchant — categorize a whole shop in one go */}
      {merchantGroups.length > 1 && allocations.length > 0 && (
        <div className="border border-border rounded-xl p-3 space-y-2 bg-muted/30">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('import.byMerchant')}</p>
              <p className="text-xs text-muted-foreground">{t('import.uncategorizedMerchants', { count: uncategorizedMerchantCount })}</p>
            </div>
            {aiEnabled && uncategorizedMerchantCount > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleSuggestCategories}
                  disabled={suggestingCats || creatingCats}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                >
                  {suggestingCats ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {t('import.aiSuggestCategories')}
                </button>
                <button
                  onClick={handleClassifyAI}
                  disabled={classifying}
                  className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-gradient-to-br from-primary to-secondary text-white hover:shadow-md transition-all disabled:opacity-50"
                >
                  {classifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {classifying ? t('import.aiClassifying') : t('import.aiClassify')}
                </button>
              </div>
            )}
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
            {merchantGroups.map(g => {
              // The group's shared category, or '' when its rows disagree / are unset.
              const allocs = g.ids.map(id => allocByRow[id] ?? '');
              const shared = allocs.every(a => a === allocs[0]) ? allocs[0] : '';
              return (
                <div key={g.merchant} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate flex items-center gap-1.5">
                      {g.label}
                      {aiMerchants.has(g.merchant) && (
                        <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                          <Sparkles className="w-2.5 h-2.5" /> {t('import.aiSuggested')}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('import.movementsCount', { count: g.ids.length })}</p>
                  </div>
                  <select
                    value={shared}
                    onChange={e => assignMerchant(g.ids, e.target.value)}
                    className="text-xs border border-border rounded-lg px-2 py-1 bg-background outline-none focus:border-primary max-w-[45%]"
                  >
                    <option value="">{t('import.uncategorized')}</option>
                    {allocations.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {proposedCats && (
        <div className="border border-primary/30 rounded-xl p-3 space-y-2 bg-primary/5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              {t('import.aiCategoriesProposed', { count: proposedCats.length })}
            </p>
            <button onClick={() => setProposedCats(null)} className="p-1 rounded hover:bg-muted transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {proposedCats.map((cat, i) => (
              <label key={i} className="flex items-center gap-2 cursor-pointer py-1">
                <input
                  type="checkbox"
                  className="accent-primary shrink-0"
                  checked={acceptedCats.has(i)}
                  onChange={() => setAcceptedCats(prev => {
                    const n = new Set(prev);
                    n.has(i) ? n.delete(i) : n.add(i);
                    return n;
                  })}
                />
                <span className="text-lg shrink-0">{cat.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{cat.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {cat.merchants.slice(0, 3).join(', ')}{cat.merchants.length > 3 ? '…' : ''}
                  </p>
                </div>
              </label>
            ))}
          </div>
          <button
            onClick={handleCreateCategories}
            disabled={creatingCats || acceptedCats.size === 0}
            className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {creatingCats ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t('import.aiCreateCategories', { count: acceptedCats.size })}
          </button>
        </div>
      )}

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">{t('import.noRowsToImport')}</p>
      ) : (
        <div className="border border-border rounded-xl divide-y divide-border max-h-[48vh] overflow-y-auto">
          {data.rows.map(r => {
            const isDup = r.status === 'duplicate';
            const isReview = r.kind === 'needs_review' && !isDup;
            const kind = confirmKindOf(r);
            return (
              <div key={r.externalId} className={`p-3 space-y-2 ${isDup ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    className="accent-primary shrink-0"
                    checked={!isDup && !!kind && !signUnknown && selected.has(r.externalId)}
                    disabled={isDup || !kind || signUnknown}
                    onChange={() => toggle(r.externalId)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{r.description || r.merchant}</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(r.date)}
                      {isDup && <> · {t('import.duplicate')}</>}
                      {kind === 'payment' && <> · {t('import.payment')}</>}
                      {!isDup && r.learnedPayment && <> · <span className="text-amber-600">{t('import.learnedPayment')}</span></>}
                      {!isDup && r.warnings?.includes('card_payment_unassigned') && <> · <span className="text-amber-600">{t('import.cardPaymentUnassigned')}</span></>}
                      {!isDup && r.warnings?.includes('possible_card_payment') && <> · <span className="text-amber-600">{t('import.possibleCardPayment')}</span></>}
                      {r.kind === 'refund' && <> · {t('import.refund')}</>}
                      {isReview && <> · <span className="text-amber-600">{t('import.reviewCredit')}</span></>}
                      {r.isFee && <> · {t('import.fee')}</>}
                      {!isDup && possibleDuplicateOf(r) && <> · <span className="text-amber-600">{t('import.possibleDuplicate')}</span></>}
                      {r.warnings?.includes('currency_mismatch') && <> · <span className="text-amber-600">{t('import.otherCurrency')}</span></>}
                    </p>
                  </div>
                  {(kind === 'expense' || kind === 'refund') && !isDup && allocations.length > 0 && (
                    <select
                      value={allocByRow[r.externalId] ?? ''}
                      onChange={e => setAllocByRow(prev => ({ ...prev, [r.externalId]: e.target.value }))}
                      className="text-xs border border-border rounded-lg px-2 py-1 bg-background outline-none focus:border-primary max-w-[40%]"
                    >
                      <option value="">{t('import.uncategorized')}</option>
                      {allocations.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                    </select>
                  )}
                  <p className={`text-sm font-display shrink-0 w-20 text-right ${r.signedAmount > 0 ? 'text-emerald-600' : ''}`}>
                    {r.signedAmount > 0 ? '+' : '-'}{fmtEuro(r.signedAmount)}
                  </p>
                </div>
                {hasPayTarget(r) && !isDup && (
                  <div className="pl-7 flex items-center gap-2">
                    <label className="text-xs text-muted-foreground shrink-0">{t('import.paysDebt')}</label>
                    <select
                      value={payTarget[r.externalId]}
                      onChange={e => changePayTarget(r, e.target.value)}
                      className="text-xs border border-border rounded-lg px-2 py-1 bg-background outline-none focus:border-primary min-w-0 flex-1"
                    >
                      <option value="">{t('import.notAPayment')}</option>
                      {(data.debts ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                )}
                {isReview && (
                  <div className="pl-7 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-amber-700 dark:text-amber-400 flex-1 min-w-[12rem]">{t('import.reviewCreditHint')}</p>
                    {(['payment', 'refund'] as const).map(k => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => resolve(r.externalId, k)}
                        disabled={k === 'payment' && !r.debtId}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${resolution[r.externalId] === k ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
                      >
                        {t(k === 'payment' ? 'import.resolvePayment' : 'import.resolveRefund')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={confirming || (selectedCount === 0 && !onConfirm)}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {t('import.importSelected', { count: selectedCount })}
      </button>
    </div>
  );
}
