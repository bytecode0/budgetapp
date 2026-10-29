import { useState, useMemo } from 'react';
import { Loader2, Check, AlertTriangle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { applyMapping, columnIndex, normHeader } from '../../../../shared/ingest/columns';
import type { ColumnMapping, DateOrder } from '../../../../shared/ingest/types';
import { shapesFromSample, type ShapeInput } from '../../../../shared/ingest/shapes';
import type { StatementSample } from '../../hooks/useImport';
import { useMoney } from '../../onboarding/useMoney';

interface ColumnMappingStepProps {
  sample: StatementSample[];
  /** Card accounts also say how purchases appear in the file. */
  isCard: boolean;
  /** Why the screen opened: the file wasn't recognised, or the user asked. */
  reason: 'unrecognized' | 'manual';
  /** A mapping to start from (the one that read the file, or the saved one). */
  initial?: ColumnMapping | null;
  saving: boolean;
  onSave: (mapping: ColumnMapping) => void;
  /** Present when the AI mapping is configured: asks for a suggestion from
   *  titles and formats only. Absent, the screen is fully manual. */
  onSuggest?: (input: ShapeInput) => Promise<{ mapping: ColumnMapping } | { code: string }>;
}

type AmountMode = 'single' | 'split';
type SignChoice = 'detect' | 'negative' | 'positive';

const MAX_DESCRIPTION_COLUMNS = 5; // as shared/ingest/validate.ts accepts
const PREVIEW_ROWS = 5;

/** The header row a person would pick: the first of the fullest rows (titles
 *  and holder lines above a table have fewer cells than the table's header). */
function guessHeaderRow(rows: string[][]): number {
  let best = 0, bestCount = -1;
  rows.forEach((r, i) => {
    const n = r.filter(c => c.trim()).length;
    if (n > bestCount) { best = i; bestCount = n; }
  });
  return best;
}

// Manual column mapping (4.2): the user says which column is the date, the
// amount (or money out / money in), the description, how dates are written
// and — for cards — how purchases appear. A live preview reads the first rows
// with the same code that will read the whole file (shared/ingest/columns.ts).
// Saved on the account, the next file is read without asking.
export function ColumnMappingStep({ sample, isCard, reason, initial, saving, onSave, onSuggest }: ColumnMappingStepProps) {
  const { t } = useTranslation();
  const { currency, locale } = useMoney();

  const firstSheet = Math.max(0, sample.findIndex(s => s.rows.length > 0));
  const [sheetIdx, setSheetIdx] = useState(firstSheet);
  const rows = sample[sheetIdx]?.rows ?? [];
  const [headerRow, setHeaderRow] = useState(() => guessHeaderRow(sample[firstSheet]?.rows ?? []));
  const header = rows[headerRow] ?? [];

  // The columns to choose from: the header row's non-empty cells, once each
  // (a mapping names columns by header text; the first match is the one read).
  const columns = useMemo(() => {
    const seen = new Set<string>();
    return header.flatMap((label, index) => {
      const key = normHeader(label);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ index, label }];
    });
  }, [header]);
  const present = (label?: string) => (label && columnIndex(header, label) >= 0 ? label : '');

  const [date, setDate] = useState(() => present(initial?.date));
  const [amountMode, setAmountMode] = useState<AmountMode>(() => (initial && !initial.amount && (initial.debit || initial.credit) ? 'split' : 'single'));
  const [amount, setAmount] = useState(() => present(initial?.amount));
  const [debit, setDebit] = useState(() => present(initial?.debit));
  const [credit, setCredit] = useState(() => present(initial?.credit));
  const [description, setDescription] = useState<string[]>(() => (initial?.description ?? []).filter(d => present(d)).slice(0, MAX_DESCRIPTION_COLUMNS));
  const [dateOrder, setDateOrder] = useState<DateOrder>(initial?.dateOrder ?? 'dmy');
  const [sign, setSign] = useState<SignChoice>(initial?.purchasesSign ?? 'detect');

  // Choosing another sheet or header row: columns are named by header text,
  // so choices that row doesn't have are dropped.
  const resetColumns = () => { setDate(''); setAmount(''); setDebit(''); setCredit(''); setDescription([]); setSuggested(false); };

  const [suggesting, setSuggesting] = useState(false);
  const [suggested, setSuggested] = useState(false);
  // The AI's suggestion fills the form; the user still checks it and saves.
  // Only titles and cell formats are sent (shared/ingest/shapes.ts).
  const handleSuggest = async () => {
    if (!onSuggest) return;
    setSuggesting(true);
    try {
      const res = await onSuggest(shapesFromSample(rows, headerRow));
      if ('code' in res) {
        toast.error(t(res.code === 'rate_limited' ? 'import.mapping.aiRateLimited' : res.code === 'no_suggestion' ? 'import.mapping.aiNoSuggestion' : 'import.mapping.aiFailed'));
        return;
      }
      const m = res.mapping;
      const real = (label?: string) => {
        const i = label ? columnIndex(header, label) : -1;
        return i >= 0 ? String(header[i]) : '';
      };
      setDate(real(m.date));
      if (m.amount) { setAmountMode('single'); setAmount(real(m.amount)); setDebit(''); setCredit(''); }
      else { setAmountMode('split'); setAmount(''); setDebit(real(m.debit)); setCredit(real(m.credit)); }
      setDescription(m.description.map(real).filter(Boolean).slice(0, MAX_DESCRIPTION_COLUMNS));
      if (m.dateOrder) setDateOrder(m.dateOrder);
      setSuggested(true);
    } finally {
      setSuggesting(false);
    }
  };

  // The sign question only applies to one signed amount column: with money
  // out / money in columns the reader already knows which is which.
  const flipped = isCard && amountMode === 'single' && sign === 'positive';
  const mapping: ColumnMapping | null = useMemo(() => {
    const hasAmount = amountMode === 'single' ? !!amount : !!(debit || credit);
    if (!date || !hasAmount) return null;
    return {
      date,
      ...(amountMode === 'single' ? { amount } : { ...(debit ? { debit } : {}), ...(credit ? { credit } : {}) }),
      description,
      dateOrder,
      ...(isCard && amountMode === 'single' && sign !== 'detect' ? { purchasesSign: sign } : {}),
    };
  }, [date, amountMode, amount, debit, credit, description, dateOrder, isCard, sign]);

  const parsed = useMemo(() => (mapping ? applyMapping(rows, headerRow, mapping) : null), [mapping, rows, headerRow]);
  const dataRowCount = Math.max(0, rows.length - headerRow - 1);

  const fmtCents = (cents: number) => {
    // Cards: shown from the holder's view (a purchase negative), as imported.
    const v = (flipped ? -cents : cents) / 100;
    return `${v < 0 ? '-' : '+'}${currency}${Math.abs(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

  const toggleDescription = (label: string) => setDescription(prev => (prev.includes(label)
    ? prev.filter(d => d !== label)
    : prev.length < MAX_DESCRIPTION_COLUMNS ? [...prev, label] : prev));

  const selectClass = 'w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm';
  const columnSelect = (value: string, onChange: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={e => onChange(e.target.value)} className={selectClass}>
      <option value="">{t('import.mapping.chooseColumn')}</option>
      {columns.map(c => <option key={c.index} value={c.label}>{c.label}</option>)}
    </select>
  );
  const chip = (active: boolean) => `text-xs px-3 py-1.5 rounded-lg border transition-colors ${active ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`;
  const rowLabel = (r: string[]) => r.filter(c => c.trim()).slice(0, 4).join(' · ').slice(0, 60) || t('import.mapping.emptyRow');

  return (
    <div className="space-y-5">
      <div className={`${reason === 'unrecognized' ? 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800' : 'bg-muted/40 border border-border'} rounded-2xl p-4 flex gap-3`}>
        {reason === 'unrecognized' && <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
        <p className="text-sm">{t(reason === 'unrecognized' ? 'import.mapping.unrecognizedIntro' : 'import.mapping.manualIntro')}</p>
      </div>

      {onSuggest && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleSuggest}
            disabled={suggesting}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t('import.mapping.aiSuggest')}
          </button>
          <p className="text-xs text-muted-foreground">{t(suggested ? 'import.mapping.aiSuggested' : 'import.mapping.aiPrivacy')}</p>
        </div>
      )}

      {sample.length > 1 && (
        <div className="space-y-2">
          <label htmlFor="map-sheet" className="text-xs text-muted-foreground">{t('import.mapping.sheet')}</label>
          <select id="map-sheet" value={sheetIdx} onChange={e => { const i = Number(e.target.value); setSheetIdx(i); setHeaderRow(guessHeaderRow(sample[i]?.rows ?? [])); resetColumns(); }} className={selectClass}>
            {sample.map((s, i) => <option key={i} value={i}>{s.sheet || t('import.mapping.sheetN', { n: i + 1 })}</option>)}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="map-header" className="text-xs text-muted-foreground">{t('import.mapping.headerRow')}</label>
        <select id="map-header" value={headerRow} onChange={e => { setHeaderRow(Number(e.target.value)); resetColumns(); }} className={selectClass}>
          {rows.map((r, i) => <option key={i} value={i}>{t('import.mapping.rowN', { n: i + 1 })}: {rowLabel(r)}</option>)}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="map-date" className="text-xs text-muted-foreground">{t('import.mapping.dateColumn')}</label>
          {columnSelect(date, setDate, 'map-date')}
        </div>
        <div className="space-y-2">
          <label htmlFor="map-date-order" className="text-xs text-muted-foreground">{t('import.mapping.dateFormat')}</label>
          <select id="map-date-order" value={dateOrder} onChange={e => setDateOrder(e.target.value as DateOrder)} className={selectClass}>
            <option value="dmy">{t('import.mapping.dmy')}</option>
            <option value="mdy">{t('import.mapping.mdy')}</option>
            <option value="ymd">{t('import.mapping.ymd')}</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('import.mapping.amountQuestion')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setAmountMode('single')} className={chip(amountMode === 'single')}>{t('import.mapping.singleAmount')}</button>
          <button type="button" onClick={() => setAmountMode('split')} className={chip(amountMode === 'split')}>{t('import.mapping.splitAmount')}</button>
        </div>
        {amountMode === 'single' ? (
          <div className="space-y-2">
            <label htmlFor="map-amount" className="text-xs text-muted-foreground">{t('import.mapping.amountColumn')}</label>
            {columnSelect(amount, setAmount, 'map-amount')}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="map-debit" className="text-xs text-muted-foreground">{t('import.mapping.debitColumn')}</label>
              {columnSelect(debit, setDebit, 'map-debit')}
            </div>
            <div className="space-y-2">
              <label htmlFor="map-credit" className="text-xs text-muted-foreground">{t('import.mapping.creditColumn')}</label>
              {columnSelect(credit, setCredit, 'map-credit')}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('import.mapping.descriptionColumns', { max: MAX_DESCRIPTION_COLUMNS })}</p>
        <div className="flex flex-wrap gap-2">
          {columns.filter(c => c.label !== date && c.label !== amount && c.label !== debit && c.label !== credit).map(c => (
            <button key={c.index} type="button" onClick={() => toggleDescription(c.label)} className={chip(description.includes(c.label))}>
              {description.includes(c.label) && <span className="mr-1">{description.indexOf(c.label) + 1}.</span>}{c.label}
            </button>
          ))}
        </div>
      </div>

      {isCard && amountMode === 'single' && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('import.signQuestion')}</p>
          <div className="flex flex-wrap gap-2">
            {(['detect', 'negative', 'positive'] as const).map(s => (
              <button key={s} type="button" onClick={() => setSign(s)} className={chip(sign === s)}>
                {t(s === 'detect' ? 'import.mapping.signDetect' : s === 'negative' ? 'import.signNegative' : 'import.signPositive')}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Live preview: the first rows as they will be read. */}
      <div className="space-y-2">
        <p className="font-display text-lg">{t('import.mapping.previewTitle')}</p>
        {!parsed ? (
          <p className="text-sm text-muted-foreground">{t('import.mapping.previewNeedsColumns')}</p>
        ) : parsed.rows.length === 0 ? (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4">
            <p className="text-sm">{t('import.mapping.previewEmpty')}</p>
          </div>
        ) : (
          <>
            <div className="border border-border rounded-xl divide-y divide-border">
              {parsed.rows.slice(0, PREVIEW_ROWS).map(r => (
                <div key={r.rowIndex} className="p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{r.description || t('import.mapping.noDescription')}</p>
                    <p className="text-xs text-muted-foreground">{fmtDay(r.date)}</p>
                  </div>
                  <p className={`text-sm font-display shrink-0 ${(r.amountCents > 0) !== flipped ? 'text-emerald-600' : ''}`}>{fmtCents(r.amountCents)}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('import.mapping.previewCount', { read: parsed.rows.length + parsed.skipped.length, total: dataRowCount })}
            </p>
          </>
        )}
      </div>

      <button
        onClick={() => mapping && onSave(mapping)}
        disabled={!mapping || !parsed || parsed.rows.length === 0 || saving}
        className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        {t('import.mapping.save')}
      </button>
    </div>
  );
}
