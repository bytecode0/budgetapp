import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Mail } from 'lucide-react';
import { XRayMark } from '../XRayMark';
import { requestEmailCode, verifyEmailCode } from './onboardingApi';

interface Props {
  onVerified: (accessToken: string, email: string) => void;
}

export function EmailBlock({ onVerified }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await requestEmailCode(email.trim().toLowerCase(), null);
    setBusy(false);
    if (err) { setError(err); return; }
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await verifyEmailCode(code.trim(), null);
    setBusy(false);
    if (err || !data) { setError(err ?? 'generic'); return; }
    onVerified(data.accessToken, data.email);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-6 py-16 md:py-24">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2.5 justify-center">
            <XRayMark className="w-7 h-7" />
            <span className="text-sm text-primary uppercase" style={{ letterSpacing: '0.1em' }}>
              {t('radiografia.onboarding.email.badge')}
            </span>
          </div>
          <h1 className="text-3xl font-display tracking-tight leading-tight">
            {t(sent ? 'radiografia.onboarding.email.codeTitle' : 'radiografia.onboarding.email.title')}
          </h1>
          <p className="text-muted-foreground">{t(sent ? 'radiografia.onboarding.email.codeSubtitle' : 'radiografia.onboarding.email.subtitle')}</p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
          {!sent ? (
            <>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  placeholder={t('radiografia.onboarding.email.placeholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-border rounded-xl bg-background outline-none focus:border-primary text-sm"
                />
              </div>
              {error && <p className="text-sm text-destructive">{t(`radiografia.onboarding.email.errors.${error}`, t('radiografia.errors.generic'))}</p>}
              <button
                onClick={sendCode}
                disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-display disabled:opacity-50"
              >
                {busy ? t('radiografia.onboarding.email.sending') : t('radiografia.onboarding.email.send')}
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
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
      </motion.div>
    </div>
  );
}
