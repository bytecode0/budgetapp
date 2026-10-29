import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, FileSpreadsheet, Loader2, Check, ArrowLeft, CreditCard, Landmark, AlertTriangle, PieChart, Columns3 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAccounts } from '../hooks/useAccounts';
import { useImport, type ImportPreview, type PurchasesSign, type PreviewSource, type ImportSummary, type StatementSample, type ColumnMapping } from '../hooks/useImport';
import { BudgetSuggestions } from './BudgetSuggestions';
import { ImportPreviewStep } from './import/ImportPreviewStep';
import { ColumnMappingStep } from './import/ColumnMappingStep';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../lib/apiErrors';

interface ImportStatementProps {
  isOpen: boolean;
  onClose: () => void;
  onImported?: () => void;
}

type Step = 'account' | 'file' | 'mapping' | 'preview' | 'summary';

/** A file the reader didn't understand: its code (shared/ingest/read.ts, or
 *  the server's 422) and, for tabular files, its first rows. */
interface ReadProblem { code: string; sample?: StatementSample[] }

// The import wizard (docs/plan-deudas-y-onboarding.md §4.6):
//   account → file → (column mapping, only if not recognised) → preview → summary.
// The file is read in this browser (decision O) and only its rows are sent;
// the preview says what each row is; the summary what was written.
export function ImportStatement({ isOpen, onClose, onImported }: ImportStatementProps) {
  const { t } = useTranslation();
  const { accounts } = useAccounts();
  const { loading, read, sample, preview, loadProfile, saveProfile } = useImport();
  const { user } = useAuth();

  const activeAccounts = accounts.filter(a => !a.isArchived);
  // Preselected: the user's own bank account, as the server's default
  // (server/lib/defaultAccount.ts) — not whichever of the couple's sorts first.
  const defaultAccount = activeAccounts.find(a => a.type !== 'card' && a.ownerUserId === user?.id)
    ?? activeAccounts.find(a => a.type !== 'card')
    ?? activeAccounts.find(a => a.ownerUserId === user?.id)
    ?? activeAccounts[0];

  const [step, setStep] = useState<Step>('account');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<PreviewSource | null>(null);
  // The manual mapping: the rows it shows, why it opened, what it starts from.
  const [mappingScreen, setMappingScreen] = useState<{ sample: StatementSample[]; reason: 'unrecognized' | 'manual'; initial: ColumnMapping | null } | null>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const [problem, setProblem] = useState<ReadProblem | null>(null);
  const [data, setData] = useState<ImportPreview | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  // The card sign the user chose in the preview (saved on the account on import).
  const [chosenSign, setChosenSign] = useState<PurchasesSign | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [postImportBudgets, setPostImportBudgets] = useState(false);

  const reset = () => {
    setStep('account'); setFile(null); setSource(null); setMappingScreen(null); setProblem(null); setData(null);
    setChosenSign(null); setSummary(null); setPostImportBudgets(false);
  };

  useEffect(() => {
    if (!isOpen) reset();
    if (isOpen && !accountId && defaultAccount) setAccountId(defaultAccount.id);
    if (isOpen) {
      fetch('/api/ai/status', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { enabled: false })
        .then(d => setAiEnabled(!!d.enabled))
        .catch(() => setAiEnabled(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const account = activeAccounts.find(a => a.id === accountId) ?? null;

  const runPreview = async (src: PreviewSource, purchasesSign?: PurchasesSign) => {
    const res = await preview(src, accountId, purchasesSign);
    if (res.error) {
      if (res.code === 'unrecognized_columns' && res.sample?.length) { openMapping(res.sample, 'unrecognized', null); return; }
      // Unknown codes and network failures: our own text, never the server's.
      toast.error(apiErrorMessage(t, { code: res.code, error: t('import.readFailed') }));
      return;
    }
    setData(res.preview!);
    setPreviewKey(k => k + 1);
    setStep('preview');
  };

  const openMapping = (rows: StatementSample[], reason: 'unrecognized' | 'manual', initial: ColumnMapping | null) => {
    setMappingScreen({ sample: rows, reason, initial });
    setStep('mapping');
  };

  const readAndPreview = async (picked: File, mapping: ColumnMapping | null) => {
    // Read here (decision O): only the rows go to the server.
    const outcome = await read(picked, mapping);
    if ('code' in outcome) {
      // Columns not recognised: straight to the manual mapping.
      if (outcome.code === 'unrecognized_columns' && outcome.sample?.length) { openMapping(outcome.sample, 'unrecognized', mapping); return; }
      setProblem(outcome);
      setStep('file');
      return;
    }
    setProblem(null);
    setSource(outcome.source);
    await runPreview(outcome.source);
  };

  const handleFile = async (picked: File | undefined) => {
    if (!picked) return;
    setFile(picked);
    setMappingScreen(null);
    setProblem(null);
    setChosenSign(null);
    await readAndPreview(picked, accountId ? await loadProfile(accountId) : null);
  };

  // "Map by hand" from an error or from the preview: the file's first rows.
  const mapByHand = async (initial: ColumnMapping | null) => {
    if (!file) return;
    const rows = problem?.sample?.length ? problem.sample : await sample(file);
    if (!rows?.length) { toast.error(t('import.mapping.notTabular')); return; }
    openMapping(rows, 'manual', initial);
  };

  // Saved on the account so its next file is read without asking; only the
  // owner may (a household member's mapping is used for this import only).
  const handleSaveMapping = async (mapping: ColumnMapping) => {
    if (!file) return;
    setSavingMapping(true);
    try {
      if (accountId) {
        const saved = await saveProfile(accountId, mapping);
        if ('ok' in saved) toast.success(t('import.mapping.saved'));
        else if (saved.status === 403) toast.info(t('import.mapping.notOwner'));
        else toast.error(t('import.mapping.saveFailed'));
      }
      setChosenSign(null);
      await readAndPreview(file, mapping);
    } finally {
      setSavingMapping(false);
    }
  };

  const handleSignChange = (sign: PurchasesSign) => {
    if (!source) return;
    setChosenSign(sign);
    runPreview(source, sign);
  };

  // After the import: the card sign the user chose becomes part of how this
  // account's files are read, so the next file isn't asked. Only the owner
  // may change it (a household member's choice stays for this import).
  const rememberSign = async () => {
    if (!accountId || !chosenSign || data?.mode !== 'card' || source?.kind !== 'rows') return;
    const mapping = source.read.mapping;
    if (!mapping || mapping.purchasesSign === chosenSign) return;
    const saved = await saveProfile(accountId, { ...mapping, description: mapping.description.slice(0, 5), purchasesSign: chosenSign });
    if ('ok' in saved) toast.success(t('import.signSaved'));
  };

  const handleConfirmed = (s: ImportSummary) => {
    setSummary(s);
    setStep('summary');
    onImported?.();
    rememberSign();
  };

  const summaryParts = (s: ImportSummary): string[] => [
    ...(s.expenses ? [t('import.summaryExpenses', { count: s.expenses })] : []),
    ...(s.incomes ? [t('import.summaryIncomes', { count: s.incomes })] : []),
    ...(s.refunds ? [t('import.summaryRefunds', { count: s.refunds })] : []),
    ...s.payments.map(p => (p.name
      ? t('import.summaryPayments', { count: p.count, name: p.name })
      : t('import.summaryPaymentsUnnamed', { count: p.count }))),
  ];

  const back = () => {
    if (step === 'file') { setProblem(null); setStep('account'); }
    else if (step === 'mapping' || step === 'preview') setStep('file');
  };
  // The mapping step is shown in the progress only when it's used.
  const steps: Step[] = mappingScreen ? ['account', 'file', 'mapping', 'preview', 'summary'] : ['account', 'file', 'preview', 'summary'];
  const stepIndex = steps.indexOf(step);
  const problemMessage = problem && (problem.code === 'reader_failed'
    ? t('import.readFailed')
    : apiErrorMessage(t, { code: problem.code, error: t('import.readFailed') }));

  return (
    <>
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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                {(step === 'file' || step === 'mapping' || step === 'preview') && (
                  <button onClick={back} aria-label={t('import.back')} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
                <h2 className="text-2xl font-display truncate">{t('import.title')}</h2>
              </div>
              <button onClick={onClose} aria-label={t('import.close')} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex gap-1.5">
                {steps.map((s, i) => (
                  <div key={s} className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-primary' : 'bg-muted'}`} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t('import.stepOf', { n: stepIndex + 1, total: steps.length })} · {t(`import.steps.${step}`)}
                {account && step !== 'account' && <> · {account.name}</>}
              </p>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.15 }}
              >
                {step === 'account' && (
                  /* ── 1. Which account or card the file belongs to ── */
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">{t('import.accountHint')}</p>
                    {activeAccounts.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-6">{t('import.noAccounts')}</p>
                    ) : (
                      <div className="space-y-2">
                        {activeAccounts.map(a => {
                          const Icon = a.type === 'card' ? CreditCard : Landmark;
                          const active = a.id === accountId;
                          return (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setAccountId(a.id)}
                              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                            >
                              <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm truncate">{a.name}</p>
                                <p className="text-xs text-muted-foreground">{t(`accounts.type.${a.type}`)}</p>
                              </div>
                              {active && <Check className="w-4 h-4 text-primary shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <button
                      onClick={() => setStep('file')}
                      disabled={!accountId}
                      className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {t('import.next')}
                    </button>
                  </div>
                )}

                {step === 'file' && (
                  /* ── 2. The file ── */
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      {t(account?.type === 'card' ? 'import.fileHintCard' : 'import.subtitle')}
                    </p>

                    {problem && (
                      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-5 space-y-3">
                        <div className="flex gap-3">
                          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="text-sm">{problemMessage}</p>
                            <p className="text-xs text-muted-foreground">{t('import.tryAnotherFile')}</p>
                          </div>
                        </div>
                        {file && (problem.code === 'no_movements' || problem.code === 'unrecognized_columns') && (
                          <button
                            type="button"
                            onClick={() => mapByHand(null)}
                            className="px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm inline-flex items-center gap-2"
                          >
                            <Columns3 className="w-4 h-4" /> {t('import.mapping.mapByHand')}
                          </button>
                        )}
                      </div>
                    )}

                    <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border rounded-2xl p-10 cursor-pointer hover:border-primary/50 transition-colors">
                      {loading ? <Loader2 className="w-8 h-8 animate-spin text-primary" /> : <Upload className="w-8 h-8 text-muted-foreground" />}
                      <span className="text-sm text-muted-foreground text-center">{loading ? t('import.reading') : t('import.dropHint')}</span>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv,.txt,.n43,.aeb,.ofx,.qfx"
                        className="hidden"
                        disabled={loading}
                        onChange={e => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">{t('import.readLocally')}</p>
                  </div>
                )}

                {step === 'mapping' && mappingScreen && (
                  /* ── 2b. Which column is what (only when not recognised, or asked) ── */
                  <ColumnMappingStep
                    sample={mappingScreen.sample}
                    isCard={account?.type === 'card'}
                    reason={mappingScreen.reason}
                    initial={mappingScreen.initial}
                    saving={savingMapping || loading}
                    onSave={handleSaveMapping}
                  />
                )}

                {step === 'preview' && data && (
                  /* ── 3. What each row is ── */
                  <ImportPreviewStep
                    key={previewKey}
                    data={data}
                    accountId={accountId}
                    aiEnabled={aiEnabled}
                    onSignChange={handleSignChange}
                    signLoading={loading}
                    onConfirmed={handleConfirmed}
                    onMapByHand={source?.kind === 'rows' && source.read.mapping ? () => mapByHand(source.read.mapping ?? null) : undefined}
                  />
                )}

                {step === 'summary' && summary && (
                  /* ── 4. What was written ── */
                  <div className="space-y-5">
                    <div className="bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 space-y-2">
                      <p className="font-display text-lg flex items-center gap-2">
                        <Check className="w-5 h-5 text-emerald-600" /> {t('import.summaryTitle')}
                      </p>
                      <p className="text-sm">
                        {summaryParts(summary).length > 0 ? summaryParts(summary).join(', ') : t('import.summaryNothing')}
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={() => setPostImportBudgets(true)}
                        className="flex-1 px-5 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm flex items-center justify-center gap-2"
                      >
                        <PieChart className="w-4 h-4" /> {t('import.suggestBudgets')}
                      </button>
                      <button
                        onClick={onClose}
                        className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm"
                      >
                        {t('import.done')}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* After a successful import: history-based budget suggestions, on request. */}
    <BudgetSuggestions
      isOpen={postImportBudgets}
      onClose={() => { setPostImportBudgets(false); onClose(); }}
      onApplied={() => onImported?.()}
    />
    </>
  );
}
