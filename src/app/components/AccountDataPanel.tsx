// Settings → "Your data and your account" (LPBETA-09): the privacy promise,
// export my data, delete my account (with an email code and 24 h to change
// your mind). Self-contained so PlanningSettings only renders it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { ChevronRight, Download, FileJson, FileSpreadsheet, Loader2, ShieldCheck, Trash2, X, Clock } from 'lucide-react';
import { useAccountDeletion } from '../hooks/useAccountDeletion';
import { apiErrorMessage } from '../lib/apiErrors';

export const PRIVACY_PROMISE_PATH = '/privacy-promise';

/** "5 de noviembre de 2026, 10:00" in the UI language. */
export function formatDeletionDate(iso: string, language: string): string {
  return new Date(iso).toLocaleString(language === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' });
}

async function downloadExport(path: string): Promise<{ error?: string; code?: string }> {
  try {
    const res = await fetch(path, { credentials: 'include' });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { error: json.error ?? 'Export failed', code: json.code };
    }
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'remanso-export';
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return {};
  } catch {
    return { error: 'Network error' };
  }
}

export function AccountDataPanel() {
  const { t, i18n } = useTranslation();
  const { deletion, sendCode, confirm, cancel } = useAccountDeletion();
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [step, setStep] = useState<'intro' | 'code'>('intro');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const errorText = (r: { error: string; code?: string }) =>
    r.code === 'otp_wait' ? t('account.delete.wait')
      : r.code === 'export_too_large' ? t('account.export.tooLarge')
      : apiErrorMessage(t, r) || t('account.genericError');

  const handleExport = async (kind: 'json' | 'csv') => {
    setExporting(kind);
    const result = await downloadExport(kind === 'json' ? '/api/account/export' : '/api/account/export/movements');
    setExporting(null);
    if (result.error) toast.error(errorText({ error: result.error, code: result.code }));
  };

  const closeDelete = () => { setShowDelete(false); setStep('intro'); setCode(''); };

  const handleSendCode = async () => {
    setBusy(true);
    const result = await sendCode();
    setBusy(false);
    if ('error' in result) { toast.error(errorText(result)); return; }
    setStep('code');
    toast.success(t('account.delete.codeSent'));
  };

  const handleConfirm = async () => {
    setBusy(true);
    const result = await confirm(code.trim());
    setBusy(false);
    if ('error' in result) { toast.error(errorText(result)); return; }
    closeDelete();
    toast.success(t('account.delete.requested'));
  };

  const handleCancel = async () => {
    setCancelling(true);
    const result = await cancel();
    setCancelling(false);
    if ('error' in result) toast.error(errorText(result));
    else toast.success(t('account.delete.cancelled'));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.58 }}
      className="bg-card border border-border rounded-3xl overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('account.sectionTitle')}</h3>
      </div>
      <div className="divide-y divide-border">
        {/* The privacy promise (public page), in a new tab like the privacy policy. */}
        <a href={PRIVACY_PROMISE_PATH} target="_blank" rel="noopener noreferrer" className="block p-5 hover:bg-muted/40 transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-pool-soft rounded-xl flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">{t('account.promise.title')}</p>
                <p className="text-sm text-muted-foreground">{t('account.promise.subtitle')}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
          </div>
        </a>

        {/* Export */}
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-pool-soft rounded-xl flex items-center justify-center shrink-0">
              <Download className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{t('account.export.title')}</p>
              <p className="text-sm text-muted-foreground">{t('account.export.subtitle')}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:pl-13">
            <button
              onClick={() => handleExport('json')}
              disabled={exporting !== null}
              className="px-4 py-2.5 border border-line-strong rounded-xl hover:bg-muted transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {exporting === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4" />}
              {t('account.export.json')}
            </button>
            <button
              onClick={() => handleExport('csv')}
              disabled={exporting !== null}
              className="px-4 py-2.5 border border-line-strong rounded-xl hover:bg-muted transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
            >
              {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              {t('account.export.csv')}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t('account.export.onlyMine')}</p>
        </div>

        {/* Delete */}
        <div className="p-5 space-y-3">
          {deletion ? (
            <div className="bg-sun-soft text-sun-ink rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Clock className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold">{t('account.delete.pendingTitle', { date: formatDeletionDate(deletion.dueAt, i18n.language) })}</p>
                  <p>{t('account.delete.pendingBody')}</p>
                </div>
              </div>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('account.delete.cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDelete(true)}
              className="w-full flex items-center justify-between gap-3 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-alert-soft rounded-xl flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5 text-destructive" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-destructive">{t('account.delete.title')}</p>
                  <p className="text-sm text-muted-foreground">{t('account.delete.subtitle')}</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
            </button>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) closeDelete(); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-account-title"
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 id="delete-account-title" className="text-2xl font-display">{t('account.delete.modalTitle')}</h2>
                <button onClick={closeDelete} aria-label={t('account.close')} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {step === 'intro' ? (
                <>
                  <ul className="list-disc pl-5 space-y-2 text-sm">
                    <li>{t('account.delete.what1')}</li>
                    <li>{t('account.delete.what2')}</li>
                    <li>{t('account.delete.what3')}</li>
                    <li>{t('account.delete.what4')}</li>
                  </ul>
                  <p className="text-sm text-muted-foreground">{t('account.delete.exportFirst')}</p>
                  <button
                    onClick={handleSendCode}
                    disabled={busy}
                    className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
                  >
                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                    {t('account.delete.sendCode')}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm">{t('account.delete.enterCode')}</p>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={t('account.delete.codeLabel')}
                    placeholder="000000"
                    className="w-full border border-line-strong rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-center text-2xl tracking-[0.5em] font-display tabular-nums"
                  />
                  <button
                    onClick={handleConfirm}
                    disabled={busy || code.length !== 6}
                    className="w-full py-3 border border-destructive/20 bg-alert-soft text-destructive hover:bg-destructive/10 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-sm font-semibold"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    {t('account.delete.confirm')}
                  </button>
                  <button onClick={handleSendCode} disabled={busy} className="w-full text-sm text-primary hover:underline disabled:opacity-50">
                    {t('account.delete.resend')}
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
