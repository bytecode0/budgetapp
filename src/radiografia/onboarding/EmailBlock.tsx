import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mail } from 'lucide-react';
import { PageShell } from '../ui/PageShell';
import { Eyebrow, Panel } from '../ui/primitives';
import { requestEmailCode, verifyEmailCode, type InsightNames } from './onboardingApi';

interface Props {
  onVerified: (accessToken: string, email: string, reportSent: boolean, reportToken: string | null) => void;
  // The statement's merchant names, held by OnboardingFlow since the upload
  // step. Handed to the server ONLY on this call — the one moment they're
  // useful — and never persisted; see InsightNames in onboardingApi.ts.
  names: InsightNames | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailBlock({ onVerified, names }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Never pre-checked, and only ever about the report. Marketing consent is a
  // separate decision and a separate column (see FinancialProfile in
  // prisma/schema.prisma) — one box must never stand for both.
  const [consent, setConsent] = useState(false);

  const emailValid = EMAIL_RE.test(email);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await requestEmailCode(email.trim().toLowerCase(), consent, null);
    setBusy(false);
    if (err) { setError(err); return; }
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await verifyEmailCode(code.trim(), names, null);
    setBusy(false);
    if (err || !data) { setError(err ?? 'generic'); return; }
    onVerified(data.accessToken, data.email, data.reportSent, data.reportToken);
  };

  return (
    <PageShell step={4}>
      <div className="text-center space-y-3 max-w-md mx-auto">
        <Eyebrow>{t('radiografia.onboarding.email.badge')}</Eyebrow>
        <h1 className="text-3xl font-display leading-tight">
          {t(sent ? 'radiografia.onboarding.email.codeTitle' : 'radiografia.onboarding.email.title')}
        </h1>
        <p className="text-muted-foreground">{t(sent ? 'radiografia.onboarding.email.codeSubtitle' : 'radiografia.onboarding.email.subtitle')}</p>
      </div>

      <div className="max-w-md mx-auto w-full">
        <Panel>
          <div className="space-y-4">
          {!sent ? (
            <>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                {/* aria-label, not a visible <label>: the design has no room for
                    one here. A placeholder is not a substitute — it disappears
                    the moment you start typing, so a screen reader announcing
                    only "edit text" leaves the field unidentified mid-entry. */}
                <input
                  type="email"
                  aria-label={t('radiografia.onboarding.email.emailLabel')}
                  placeholder={t('radiografia.onboarding.email.placeholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
                />
              </div>
              <label className="flex items-start gap-3 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={event => setConsent(event.target.checked)}
                  className="mt-0.5 w-4 h-4 shrink-0 accent-primary"
                />
                <span>
                  {t('radiografia.onboarding.email.consentLabel')}{' '}
                  <a href={t('radiografia.onboarding.email.privacyUrl')} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
                    {t('radiografia.onboarding.email.privacyLink')}
                  </a>
                </span>
              </label>
              {error && <p className="text-sm text-destructive">{t(`radiografia.onboarding.email.errors.${error}`, t('radiografia.errors.generic'))}</p>}
              <button
                onClick={sendCode}
                disabled={busy || !emailValid || !consent}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50"
              >
                {busy ? t('radiografia.onboarding.email.sending') : t('radiografia.onboarding.email.send')}
              </button>
              {/* A disabled button always says why it is disabled. */}
              {!busy && (!emailValid || !consent) && (
                <p className="text-xs text-muted-foreground text-center">
                  {t(!emailValid ? 'radiografia.onboarding.email.needEmail' : 'radiografia.onboarding.email.needConsent')}
                </p>
              )}
            </>
          ) : (
            <>
              {/* The placeholder here is six bullets — decorative, and useless
                  as an accessible name. Without aria-label this field announces
                  itself as an unlabelled text box on the one screen where the
                  visitor has to know exactly what to type. */}
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                aria-label={t('radiografia.onboarding.email.codeLabel')}
                placeholder="••••••"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center text-2xl tracking-[0.5em] py-3 border border-border rounded-xl bg-background outline-none focus:border-primary"
              />
              {error && <p className="text-sm text-destructive text-center">{t(`radiografia.onboarding.email.errors.${error}`, t('radiografia.errors.generic'))}</p>}
              <button
                onClick={verify}
                disabled={busy || code.length !== 6}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50"
              >
                {busy ? t('radiografia.onboarding.email.verifying') : t('radiografia.onboarding.email.verify')}
              </button>
              <button
                onClick={() => { setSent(false); setCode(''); setError(null); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('radiografia.onboarding.email.changeEmail')}
              </button>
            </>
          )}
          </div>
        </Panel>
      </div>
    </PageShell>
  );
}
