import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, FileSpreadsheet, Loader2, Check, ArrowLeft, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { useAccounts } from '../hooks/useAccounts';
import { useAllocations } from '../hooks/useAllocations';
import { useImport, type ImportPreview, type ConfirmRow, type AiCategory } from '../hooks/useImport';

interface ImportStatementProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export function ImportStatement({ isOpen, onClose, onImported }: ImportStatementProps) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const { accounts } = useAccounts();
  const { allocations, createAllocation } = useAllocations();
  const { loading, confirming, classifying, suggestingCats, preview, confirm, classify, suggestCategories } = useImport();

  const activeAccounts = accounts.filter(a => !a.isArchived);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [data, setData] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allocByRow, setAllocByRow] = useState<Record<string, string>>({});
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiMerchants, setAiMerchants] = useState<Set<string>>(new Set());
  const [proposedCats, setProposedCats] = useState<AiCategory[] | null>(null);
  const [acceptedCats, setAcceptedCats] = useState<Set<number>>(new Set());
  const [creatingCats, setCreatingCats] = useState(false);

  useEffect(() => {
    if (!isOpen) { setData(null); setSelected(new Set()); setAllocByRow({}); setAiMerchants(new Set()); setProposedCats(null); }
    if (isOpen && !accountId && activeAccounts.length > 0) setAccountId(activeAccounts[0].id);
    if (isOpen) {
      fetch('/api/ai/status', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { enabled: false })
        .then(d => setAiEnabled(!!d.enabled))
        .catch(() => setAiEnabled(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const fmtEuro = (v: number) => `€${Math.abs(v).toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const res = await preview(file);
    if (res.error) { toast.error(res.error); return; }
    const p = res.preview!;
    setData(p);
    // Default: select all new rows; pre-fill suggested allocation per expense.
    setSelected(new Set(p.rows.filter(r => r.status === 'new').map(r => r.externalId)));
    setAllocByRow(Object.fromEntries(p.rows.filter(r => r.suggestedAllocationId).map(r => [r.externalId, r.suggestedAllocationId!])));
  };

  // Group new expense rows by merchant so the user can categorize a whole shop at
  // once instead of row by row. Sorted by frequency (most movements first).
  const merchantGroups = useMemo(() => {
    const map = new Map<string, { merchant: string; label: string; ids: string[] }>();
    (data?.rows ?? [])
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

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleConfirm = async () => {
    if (!data) return;
    const rows: ConfirmRow[] = data.rows
      .filter(r => r.status === 'new' && selected.has(r.externalId))
      .map(r => ({
        kind: r.kind,
        externalId: r.externalId,
        date: r.date,
        description: r.description,
        merchant: r.merchant,
        amount: r.amount,
        allocationId: r.kind === 'expense' ? (allocByRow[r.externalId] || null) : undefined,
      }));
    if (rows.length === 0) { toast.error(t('import.nothingSelected')); return; }
    const res = await confirm(accountId, rows);
    if (res.error) { toast.error(res.error); return; }
    toast.success(t('import.importedOk', { count: res.inserted ?? rows.length }));
    onImported?.();
    onClose();
  };

  const selectedCount = data ? data.rows.filter(r => r.status === 'new' && selected.has(r.externalId)).length : 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 flex items-end md:items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            className="bg-card border border-border rounded-2xl p-6 w-full max-w-2xl space-y-5 max-h-[88vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {data && (
                  <button onClick={() => setData(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <h2 className="text-2xl font-display">{t('import.title')}</h2>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!data ? (
              /* ── Step 1: pick account + file ── */
              <div className="space-y-5">
                <p className="text-sm text-muted-foreground">{t('import.subtitle')}</p>

                {activeAccounts.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('import.account')}</label>
                    <select
                      value={accountId ?? ''}
                      onChange={e => setAccountId(e.target.value || null)}
                      className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
                    >
                      {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                )}

                <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-2xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
                  {loading ? <Loader2 className="w-8 h-8 animate-spin text-primary" /> : <Upload className="w-8 h-8 text-muted-foreground" />}
                  <span className="text-sm text-muted-foreground">{loading ? t('import.reading') : t('import.dropHint')}</span>
                  <input
                    type="file"
                    accept=".xlsx,.csv"
                    className="hidden"
                    disabled={loading}
                    onChange={e => handleFile(e.target.files?.[0])}
                  />
                </label>
              </div>
            ) : (
              /* ── Step 2: preview + confirm ── */
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary">{t('import.newCount', { count: data.newCount })}</span>
                  <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.dupCount', { count: data.duplicateCount })}</span>
                  <span className="px-2.5 py-1 rounded-full bg-muted text-muted-foreground">{t('import.expenseCount', { count: data.expenseCount })}</span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">{t('import.incomeCount', { count: data.incomeCount })}</span>
                </div>

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

                <div className="border border-border rounded-xl divide-y divide-border max-h-[48vh] overflow-y-auto">
                  {data.rows.map(r => {
                    const isDup = r.status === 'duplicate';
                    return (
                      <div key={r.externalId} className={`flex items-center gap-3 p-3 ${isDup ? 'opacity-50' : ''}`}>
                        <input
                          type="checkbox"
                          className="accent-primary shrink-0"
                          checked={!isDup && selected.has(r.externalId)}
                          disabled={isDup}
                          onChange={() => toggle(r.externalId)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{r.description || r.merchant}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(r.date)}
                            {isDup && <> · {t('import.duplicate')}</>}
                          </p>
                        </div>
                        {r.kind === 'expense' && !isDup && allocations.length > 0 && (
                          <select
                            value={allocByRow[r.externalId] ?? ''}
                            onChange={e => setAllocByRow(prev => ({ ...prev, [r.externalId]: e.target.value }))}
                            className="text-xs border border-border rounded-lg px-2 py-1 bg-background outline-none focus:border-primary max-w-[40%]"
                          >
                            <option value="">{t('import.uncategorized')}</option>
                            {allocations.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                          </select>
                        )}
                        <p className={`text-sm font-display shrink-0 w-20 text-right ${r.kind === 'income' ? 'text-emerald-600' : ''}`}>
                          {r.kind === 'income' ? '+' : '-'}{fmtEuro(r.signedAmount)}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={handleConfirm}
                  disabled={confirming || selectedCount === 0}
                  className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('import.importSelected', { count: selectedCount })}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
