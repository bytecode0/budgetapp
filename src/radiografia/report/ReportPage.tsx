import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import '../xray-theme.css';
import { XRayMark } from '../XRayMark';
import { ensurePlausibleLoaded } from '../analytics';
import { ReportView } from './ReportView';
import { useReport } from './useReport';

// The token is the sole authorization (same trust model as
// RadiografiaAccessToken elsewhere in this app) — a 32-byte hex string, so a
// path that doesn't match it can't possibly be a valid report link.
function tokenFromPath(): string | null {
  const m = window.location.pathname.match(/^\/informe\/([0-9a-f]{64})/);
  return m ? m[1] : null;
}

function LoadingSpinner() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function ErrorScreen({ messageKey }: { messageKey: string }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center space-y-3">
      <XRayMark className="w-8 h-8" />
      <h1 className="text-2xl font-display">{t('radiografia.report.notFoundTitle')}</h1>
      <p className="text-sm text-muted-foreground max-w-sm">{t(messageKey, t('radiografia.report.notFoundBody'))}</p>
    </div>
  );
}

// The permanent web report. Nothing but the fetch and the page chrome lives
// here — the report itself is ReportView, shared with the last step of the
// onboarding so the two can never drift apart.
export function ReportPage() {
  const { i18n } = useTranslation();
  useEffect(() => { if (i18n.language !== 'es') i18n.changeLanguage('es'); }, [i18n]);
  useEffect(() => { ensurePlausibleLoaded(); }, []);

  const { report, error, loading } = useReport(tokenFromPath());

  if (loading) return <LoadingSpinner />;
  if (error || !report) return <ErrorScreen messageKey={`radiografia.report.errors.${error ?? 'not_found'}`} />;

  return <ReportView report={report} />;
}
