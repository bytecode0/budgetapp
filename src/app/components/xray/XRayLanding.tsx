import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, ShieldCheck, FileSpreadsheet, ChevronDown, Lock, Trash2, X } from 'lucide-react';
import { XRayMark } from './XRayMark';

const SUPPORTED_BANKS = ['BBVA', 'Santander', 'CaixaBank', 'ING', 'Sabadell', 'Revolut'];
const MAX_FILES = 5;

interface Props {
  onFiles: (files: File[]) => void;
  analyzing: boolean;
  error: string | null;
}

export function XRayLanding({ onFiles, analyzing, error }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [selected, setSelected] = useState<File[]>([]);

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
  const submit = () => { if (selected.length > 0) onFiles(selected); };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-6 py-16 md:py-24">
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl text-center space-y-6"
      >
        <div className="inline-flex items-center gap-2.5">
          <XRayMark className="w-7 h-7" />
          <span className="text-sm text-primary uppercase" style={{ letterSpacing: '0.1em' }}>
            {t('radiografia.landing.badge')}
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl font-display tracking-tight leading-tight">
          {t('radiografia.landing.title')}
        </h1>
        <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
          {t('radiografia.landing.subtitle')}
        </p>
      </motion.div>

      {/* Uploader */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="w-full max-w-2xl mt-10"
      >
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          onClick={() => !analyzing && inputRef.current?.click()}
          className={`cursor-pointer rounded-3xl border-2 border-dashed p-12 md:p-16 text-center transition-all
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
          <div className="w-16 h-16 mx-auto rounded-2xl bg-primary flex items-center justify-center shadow-xl mb-5">
            <Upload className="w-8 h-8 text-primary-foreground" />
          </div>
          <p className="font-display text-lg">{t('radiografia.landing.dropTitle')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('radiografia.landing.dropHint')}</p>
          <div className="mt-5 inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-display">
            <FileSpreadsheet className="w-4 h-4" />
            {selected.length > 0 ? t('radiografia.landing.addMore') : t('radiografia.landing.cta')}
          </div>
          <p className="text-xs text-muted-foreground mt-3">{t('radiografia.landing.multiHint')}</p>
        </div>

        {/* Selected files + analyze button */}
        {selected.length > 0 && (
          <div className="mt-4 space-y-2">
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
              {t('radiografia.landing.analyze', { count: selected.length })}
            </button>
          </div>
        )}

        {error && (
          <p className="mt-4 text-center text-sm text-destructive">{t(`radiografia.errors.${error}`, t('radiografia.errors.generic'))}</p>
        )}

        {/* Privacy — visceral, not legalese */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-primary" />{t('radiografia.landing.trustNoSignup')}</span>
          <span className="inline-flex items-center gap-1.5"><Lock className="w-4 h-4 text-primary" />{t('radiografia.landing.trustPrivate')}</span>
          <span className="inline-flex items-center gap-1.5"><Trash2 className="w-4 h-4 text-primary" />{t('radiografia.landing.trustDeleted')}</span>
        </div>
      </motion.div>

      {/* How to download + supported banks */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="w-full max-w-2xl mt-10 space-y-4"
      >
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <button
            onClick={() => setHowOpen(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
          >
            <span className="font-display">{t('radiografia.landing.howTitle')}</span>
            <ChevronDown className={`w-5 h-5 transition-transform ${howOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence initial={false}>
            {howOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <ol className="px-6 pb-5 space-y-3 text-sm text-muted-foreground list-decimal list-inside">
                  <li>{t('radiografia.landing.howStep1')}</li>
                  <li>{t('radiografia.landing.howStep2')}</li>
                  <li>{t('radiografia.landing.howStep3')}</li>
                </ol>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="text-center">
          <p className="text-xs text-muted-foreground mb-3">{t('radiografia.landing.supportedBanks')}</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {SUPPORTED_BANKS.map(b => (
              <span key={b} className="px-3 py-1 rounded-full bg-muted text-xs text-muted-foreground">{b}</span>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
