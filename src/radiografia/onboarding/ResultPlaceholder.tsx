import { useTranslation } from 'react-i18next';
import { Suspense, lazy, useState } from 'react';
import { CheckCircle2, ArrowRight, AlertTriangle } from 'lucide-react';
import { PageShell } from '../ui/PageShell';
import { Panel, toneColor } from '../ui/primitives';
import { useReport } from '../report/useReport';

// The last step of the onboarding, and the first place the finished report is
// shown. It used to be a teaser — stage name plus a link — which meant the
// thing the whole funnel promised was only reachable by clicking through, or by
// receiving an email. The report is rendered right here now (ReportView, the
// same component behind /informe/<token>); the permanent link stays, but as
// "keep this", not as the only way in.
//
// The stage is deliberately NOT repeated above the report: the report's own
// hero opens with it. Its teaser only appears when the report could not be
// loaded, as the fallback that keeps this screen from being empty.
const ReportView = lazy(() => import('../report/ReportView').then(m => ({ default: m.ReportView })));

interface Props {
  email: string | null;
  stageId: string | null;
  branchId: string | null;
  // Radiografia.id — both the source of the report rendered below and the
  // permanent URL. Null only if the profile somehow has no snapshot at all, in
  // which case this screen falls back to the stage teaser.
  reportToken: string | null;
  reportSent: boolean | null;
  onResend: () => Promise<boolean>;
}

function ReportSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function ResultPlaceholder({ email, stageId, branchId, reportToken, reportSent, onResend }: Props) {
  const { t } = useTranslation();
  const stageKey = branchId ?? stageId;
  const [resending, setResending] = useState(false);
  const { report, error: reportError, loading: reportLoading } = useReport(reportToken);

  const resend = async () => {
    setResending(true);
    await onResend();
    setResending(false);
  };

  const delivered = reportSent === true;
  const tone = delivered ? 'good' : 'warn';

  return (
    <PageShell step="done" width={report ? 'full' : 'wide'}>
      {email && reportSent !== null && (
        <div
          className="rounded-3xl border p-5 flex gap-4 items-start"
          style={{
            background: delivered ? 'var(--xray-good-bg)' : 'var(--xray-warn-bg)',
            borderColor: delivered ? 'var(--xray-good-border)' : 'var(--xray-warn-border)',
          }}
        >
          {delivered
            ? <CheckCircle2 className="w-6 h-6 shrink-0 mt-0.5" style={{ color: toneColor('good') }} />
            : <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" style={{ color: toneColor('warn') }} />}
          <div className="space-y-1">
            <p className="font-display text-lg">
              {t(delivered ? 'radiografia.onboarding.result.deliverySentTitle' : 'radiografia.onboarding.result.deliveryFailedTitle')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(delivered ? 'radiografia.onboarding.result.deliverySentBody' : 'radiografia.onboarding.result.deliveryFailedBody', { email })}
            </p>
            {!delivered && (
              <button onClick={resend} disabled={resending} className="text-sm underline underline-offset-4 disabled:opacity-50" style={{ color: toneColor('warn') }}>
                {t(resending ? 'radiografia.onboarding.result.resending' : 'radiografia.onboarding.result.resend')}
              </button>
            )}
          </div>
        </div>
      )}

      {reportToken && reportLoading && <ReportSpinner label={t('radiografia.onboarding.result.reportLoading')} />}

      {report && (
        <Suspense fallback={<ReportSpinner label={t('radiografia.onboarding.result.reportLoading')} />}>
          <ReportView report={report} embedded />
        </Suspense>
      )}

      {/* Fallback: no token at all, or the fetch failed. The stage is the one
          piece of the diagnosis this screen holds on its own, so it is shown
          here and only here — never alongside a report that already says it. */}
      {!report && !reportLoading && (
        <Panel className="text-center">
          {stageKey ? (
            <>
              <p className="text-xs uppercase" style={{ letterSpacing: '0.1em', color: 'var(--primary)' }}>
                {t('radiografia.onboarding.result.stageBadge')}
              </p>
              <h1 className="text-3xl font-display mt-1">{t(`radiografia.methodStage.${stageKey}.name`)}</h1>
              <p className="text-muted-foreground mt-2">{t(`radiografia.methodStage.${stageKey}.description`)}</p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-display">{t('radiografia.onboarding.result.title')}</h1>
              <p className="text-muted-foreground mt-2">
                {email ? t('radiografia.onboarding.result.subtitleWithEmail', { email }) : t('radiografia.onboarding.result.subtitle')}
              </p>
            </>
          )}
          {reportToken && (
            <p className="text-sm text-muted-foreground mt-4">
              {t(`radiografia.onboarding.result.errors.${reportError ?? 'generic'}`, t('radiografia.onboarding.result.reportError'))}
            </p>
          )}
        </Panel>
      )}

      {reportToken && !reportLoading && (
        <div className="flex justify-center no-print">
          <a
            href={`/informe/${reportToken}`}
            className="w-full max-w-md inline-flex items-center justify-center gap-2 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display"
          >
            {t('radiografia.onboarding.result.viewFullReport')}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      )}
    </PageShell>
  );
}
