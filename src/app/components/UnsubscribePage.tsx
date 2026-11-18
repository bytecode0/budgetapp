import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { CheckCircle2, Loader2, Mail } from 'lucide-react';
import { RemansoMark } from './shared/RemansoMark';

// Public page (no session) at /unsubscribe?token=…&lang=…, the link in the
// monthly email (LPBETA-12). Asks first and then POSTs, so a mail scanner that
// opens every link never unsubscribes anyone. The token is signed by the
// server (server/lib/unsubscribe.ts) and only turns the monthly email off.
export function UnsubscribePage() {
  const { t, i18n } = useTranslation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const lang = params.get('lang');
  const [state, setState] = useState<'ask' | 'busy' | 'done' | 'error'>(token ? 'ask' : 'error');

  useEffect(() => {
    if ((lang === 'es' || lang === 'en') && i18n.language !== lang) i18n.changeLanguage(lang);
  }, [lang, i18n]);

  const confirm = async () => {
    setState('busy');
    try {
      const res = await fetch('/api/insights/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="w-full bg-card border-b border-border py-4 px-4 sm:px-8">
        <a href="/" className="flex items-center gap-2 w-fit">
          <RemansoMark className="w-8 h-8" />
          <span className="font-display text-lg">remanso</span>
        </a>
      </header>
      <main className="max-w-md mx-auto px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
          className="bg-card border border-border rounded-2xl p-6 space-y-4 text-center"
        >
          <div className="w-16 h-16 bg-pool-soft text-pool rounded-2xl flex items-center justify-center mx-auto">
            {state === 'done' ? <CheckCircle2 className="w-8 h-8" /> : <Mail className="w-8 h-8" />}
          </div>
          {state === 'done' ? (
            <>
              <h1 className="font-display text-2xl">{t('unsubscribe.doneTitle')}</h1>
              <p className="text-sm text-muted-foreground">{t('unsubscribe.doneDesc')}</p>
            </>
          ) : state === 'error' ? (
            <>
              <h1 className="font-display text-2xl">{t('unsubscribe.errorTitle')}</h1>
              <p className="text-sm text-muted-foreground">{t('unsubscribe.errorDesc')}</p>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl">{t('unsubscribe.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('unsubscribe.desc')}</p>
              <button
                onClick={confirm}
                disabled={state === 'busy'}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {state === 'busy' && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('unsubscribe.confirm')}
              </button>
            </>
          )}
          <a href="/" className="block text-sm text-primary hover:underline">{t('unsubscribe.backToApp')}</a>
        </motion.div>
      </main>
    </div>
  );
}
