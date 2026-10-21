import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileSpreadsheet, Trash2, X, Pencil } from 'lucide-react';
import { money } from '../format';
import { PageShell } from '../ui/PageShell';
import { Panel, SectionHead, StatCard } from '../ui/primitives';
import { uploadExtracto, type ExtractoDetected, type InsightNames } from './onboardingApi';
import { trackPlausible } from '../analytics';

// Bloque 3 (plan F11). The statement upload is now the ONLY entry point —
// the product owner's call: without a statement, the report has too little to
// say to be worth the friction of asking for one. There is deliberately no
// skip path here anymore; FinancialContextBlock right after this step still
// fills the gaps a statement can't answer (housing, essentials, available
// cushion — see registry.v1.ts), it just never stands on its own.
const MAX_FILES = 5;

interface Props {
  accessToken: string | null;
  // `detected` is owned by OnboardingFlow, not by this component. Going "back"
  // from the context step returns here, and local state would have been
  // discarded on unmount — forcing a re-upload of a statement that was already
  // read and corrected.
  detected: ExtractoDetected | null;
  onDetectedChange: (detected: ExtractoDetected, insightNames?: InsightNames) => void;
  onDetected: (detected: ExtractoDetected) => void;
}

export function EnrichmentBlock({ accessToken, detected, onDetectedChange, onDetected }: Props) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    // "El primer campo rellenado" for this screen is picking a file — fired
    // once per mount, on the first file(s) added, never on "add another".
    if (selected.length === 0) trackPlausible('radiografia_iniciada');
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
    try {
      // uploadExtracto can reject outright, not just return an error: reading
      // the file can fail, and a dropped connection makes fetch throw. Without
      // this, `analyzing` stayed true forever and the screen sat on
      // "Analizando…" with nothing said — the exact dead-end this pass exists
      // to remove.
      const { data, error: err } = await uploadExtracto(selected, accessToken);
      if (err || !data) { setError(err ?? 'generic'); return; }
      onDetectedChange(data.detected, data.insightNames);
    } catch {
      setError('generic');
    } finally {
      setAnalyzing(false);
    }
  };

  if (detected) {
    const patchDetected = (next: Partial<ExtractoDetected>) => onDetectedChange({ ...detected, ...next });
    const numberValue = (value: number | null) => value === null ? '' : String(value);
    const updateNumber = (key: 'monthlyIncome' | 'savingMonthly' | 'investmentMonthly' | 'accountBalance', raw: string) => {
      const value = raw === '' ? 0 : Number.parseFloat(raw.replace(',', '.'));
      if (Number.isFinite(value)) patchDetected({ [key]: value } as Partial<ExtractoDetected>);
    };
    const fromStatement = t('radiografia.onboarding.enrichment.originStatement', { count: detected.months });
    // Read mode groups saving + investment into one "you're setting aside"
    // figure, the way a person thinks about it. Edit mode splits them again,
    // because they reach the stage engine as two separate fields.
    const setAside = detected.savingMonthly + detected.investmentMonthly;

    return (
      <PageShell step={2} width="wide">
        <SectionHead
          eyebrow={t('radiografia.onboarding.enrichment.reviewEyebrow')}
          title={t('radiografia.onboarding.enrichment.reviewHeadline', { count: detected.months })}
          intro={t('radiografia.onboarding.enrichment.reviewMovements', { count: detected.transactionCount })}
        />

        {/* The same StatCard the report opens with. Seeing your own figures in
            the report's own component, one step before the report exists, is
            most of what makes the two feel like one product. */}
        {editing ? (
          <Panel>
            <div className="space-y-4">
              {([
                ['monthlyIncome', 'gridIncome'],
                ['savingMonthly', 'reviewSavingLabel'],
                ['investmentMonthly', 'reviewInvestmentLabel'],
                ['accountBalance', 'gridBalance'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-4">
                  <span className="text-sm">{t(`radiografia.onboarding.enrichment.${label}`)}</span>
                  <input
                    value={numberValue(detected[key])}
                    inputMode="decimal"
                    onChange={event => updateNumber(key, event.target.value)}
                    className="w-32 text-right px-3 py-2 rounded-xl border border-border bg-background text-sm outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
          </Panel>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {[
              { label: 'gridIncome', value: detected.monthlyIncome, caption: fromStatement },
              { label: 'gridExpenses', value: detected.monthlyExpenses, caption: fromStatement },
              { label: 'gridSetAside', value: setAside, caption: fromStatement },
              { label: 'gridBalance', value: detected.accountBalance ?? 0, caption: t('radiografia.onboarding.enrichment.originBalance') },
            ].map(({ label, value, caption }) => (
              <StatCard
                key={label}
                label={t(`radiografia.onboarding.enrichment.${label}`)}
                value={money(value, i18n.language)}
                note={caption}
              />
            ))}
          </div>
        )}

        {detected.debtsCount > 0 && (
          <Panel className="!p-5">
            <p className="text-sm">{t('radiografia.onboarding.enrichment.detectedDebts', { count: detected.debtsCount })}</p>
          </Panel>
        )}

        <p className="text-xs text-muted-foreground flex gap-1.5 items-center justify-center text-center">
          <Pencil className="w-3.5 h-3.5 shrink-0" />{t('radiografia.onboarding.enrichment.reviewEditHint')}
        </p>

        <div className="space-y-3">
          <button
            onClick={() => onDetected(detected)}
            className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display"
          >
            {t('radiografia.onboarding.enrichment.reviewContinue')}
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
          >
            {t(editing ? 'radiografia.onboarding.enrichment.doneEditing' : 'radiografia.onboarding.enrichment.notCorrect')}
          </button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell step={1} width="wide">
      <div className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-display leading-tight">{t('radiografia.onboarding.enrichment.title')}</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">{t('radiografia.onboarding.enrichment.subtitle')}</p>
      </div>

      {/* Why the statement is mandatory sits in its own tinted panel rather
          than as a third grey paragraph: it is the answer to the objection
          this screen actually raises, not a footnote to the subtitle. */}
      <div
        className="rounded-2xl border p-4 text-sm text-center"
        style={{ background: 'var(--xray-good-bg)', borderColor: 'var(--xray-good-border)' }}
      >
        {t('radiografia.onboarding.enrichment.whyRequired')}
      </div>

      {/* Drop zone. Dragging a file is a mouse-only gesture by nature, so the
          keyboard path is the real <button> below — not this container. The
          container keeps its click handler because clicking anywhere in a large
          target is what mouse users expect ("o haz clic para elegir un
          archivo"), but it is deliberately NOT focusable or role="button": that
          would announce the same action twice to a screen reader. */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => !analyzing && inputRef.current?.click()}
        className={`cursor-pointer rounded-[32px] border-2 border-dashed p-10 md:p-14 text-center transition-all
          ${dragOver ? 'border-primary scale-[1.01]' : 'border-border hover:border-primary/40'}
          ${analyzing ? 'pointer-events-none opacity-60' : ''}`}
        style={{ background: dragOver ? 'var(--xray-good-bg)' : 'var(--card)' }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          tabIndex={-1}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <div
          className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'var(--primary)', boxShadow: 'var(--xray-shadow-mark)' }}
        >
          <Upload className="w-7 h-7 text-primary-foreground" aria-hidden="true" />
        </div>
        <p className="font-display text-lg">{t('radiografia.onboarding.enrichment.dropTitle')}</p>
        <p className="text-sm text-muted-foreground mt-1">{t('radiografia.onboarding.enrichment.dropHint')}</p>
        {/* A real <button>, not a styled div: this is the only way a keyboard or
            screen-reader user can reach the file picker at all. stopPropagation
            keeps the parent's onClick from firing too, which would open the
            picker twice. */}
        <button
          type="button"
          disabled={analyzing}
          onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
          className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-display text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
          {selected.length > 0 ? t('radiografia.onboarding.enrichment.addMore') : t('radiografia.onboarding.enrichment.cta')}
        </button>
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
              <button
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                aria-label={t('radiografia.onboarding.enrichment.removeFile')}
              >
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
    </PageShell>
  );
}
