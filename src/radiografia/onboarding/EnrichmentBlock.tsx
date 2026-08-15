import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Upload, FileSpreadsheet, Trash2, X } from 'lucide-react';
import { XRayMark } from '../XRayMark';
import { money } from '../format';
import { uploadExtracto, type ExtractoDetected } from './onboardingApi';

// Bloque 3 (plan F11, brought forward from "flagged/waitlist" at the user's
// request): the optional bank-statement step. Never a gate — "skip" always
// works, matching the brief's "el extracto es siempre opcional, nunca puerta
// de entrada".
const MAX_FILES = 5;

interface Props {
  accessToken: string | null;
  onDone: (stageId: string | null, branchId: string | null) => void;
  onSkip: () => void;
}

export function EnrichmentBlock({ accessToken, onDone, onSkip }: Props) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<ExtractoDetected | null>(null);
  const [stageResult, setStageResult] = useState<{ stageId: string | null; branchId: string | null } | null>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setSelected(prev => {
      const merged = [...prev];
      for (const f of incoming) {
        if (merged.length >= MAX_FILES) break;
        if (!merged.some(m => m.name === f.name && m.size === f.size)) merged.push(f);
      }
      return merged;
    });
  };
  const removeFile = (i: number) => setSelected(prev => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    if (selected.length === 0) return;
    setAnalyzing(true);
    setError(null);
    const { data, error: err } = await uploadExtracto(selected, accessToken);
    setAnalyzing(false);
    if (err || !data) { setError(err ?? 'generic'); return; }
    setDetected(data.detected);
    setStageResult({ stageId: data.stage.stageId, branchId: data.stage.branchId });
  };

  if (detected && stageResult) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
          <XRayMark className="w-7 h-7 mx-auto" />
          <div className="bg-card border border-border rounded-2xl p-6 text-left space-y-2">
            <p className="font-display text-lg text-center mb-3">{t('radiografia.onboarding.enrichment.detectedTitle')}</p>
            <p className="text-sm">{t('radiografia.onboarding.enrichment.detectedIncome', { amount: money(detected.monthlyIncome, i18n.language) })}</p>
            {detected.accountBalance !== null && (
              <p className="text-sm">{t('radiografia.onboarding.enrichment.detectedBalance', { amount: money(detected.accountBalance, i18n.language) })}</p>
            )}
            {detected.debtsCount > 0 && (
              <p className="text-sm">{t('radiografia.onboarding.enrichment.detectedDebts', { count: detected.debtsCount })}</p>
            )}
          </div>
          <button
            onClick={() => onDone(stageResult.stageId, stageResult.branchId)}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display"
          >
            {t('radiografia.onboarding.enrichment.continue')}
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-6 py-16 md:py-24">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-2xl text-center space-y-6">
        <div className="inline-flex items-center gap-2.5 justify-center">
          <XRayMark className="w-7 h-7" />
        </div>
        <h1 className="text-3xl font-display tracking-tight leading-tight">{t('radiografia.onboarding.enrichment.title')}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">{t('radiografia.onboarding.enrichment.subtitle')}</p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="w-full max-w-2xl mt-8 space-y-4">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => !analyzing && inputRef.current?.click()}
          className={`cursor-pointer rounded-3xl border-2 border-dashed p-10 md:p-14 text-center transition-all
            ${dragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border bg-card hover:border-primary/40'}
            ${analyzing ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
          />
          <div className="w-14 h-14 mx-auto rounded-2xl bg-primary flex items-center justify-center shadow-xl mb-4">
            <Upload className="w-7 h-7 text-primary-foreground" />
          </div>
          <p className="font-display">{t('radiografia.onboarding.enrichment.dropTitle')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('radiografia.onboarding.enrichment.dropHint')}</p>
          <div className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-display text-sm">
            <FileSpreadsheet className="w-4 h-4" />
            {selected.length > 0 ? t('radiografia.onboarding.enrichment.addMore') : t('radiografia.onboarding.enrichment.cta')}
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t('radiografia.onboarding.enrichment.multiHint')}</p>
        </div>

        <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1.5">
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          {t('radiografia.onboarding.enrichment.uploadDisclosure')}
        </p>

        {selected.length > 0 && (
          <div className="space-y-2">
            {selected.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-2.5">
                <FileSpreadsheet className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm truncate flex-1">{f.name}</span>
                <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive transition-colors shrink-0" aria-label="remove">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={submit}
              disabled={analyzing}
              className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50"
            >
              {analyzing ? t('radiografia.onboarding.enrichment.analyzing') : t('radiografia.onboarding.enrichment.analyze')}
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive text-center">{t(`radiografia.onboarding.enrichment.errors.${error}`, t('radiografia.errors.generic'))}</p>
        )}

        <button onClick={onSkip} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4">
          {t('radiografia.onboarding.enrichment.skip')}
        </button>
      </motion.div>
    </div>
  );
}
