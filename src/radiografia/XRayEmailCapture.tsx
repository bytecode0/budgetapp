import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { CheckCircle2, ArrowRight, FileText, BookOpen } from 'lucide-react';
import { XRayMark } from './XRayMark';

interface Props {
  onSubmit: (email: string) => Promise<{ ok: boolean }>;
  onCreateAccount: () => void;
}

export function XRayEmailCapture({ onSubmit, onCreateAccount }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const submit = async () => {
    if (!valid || sending) return;
    setSending(true);
    const { ok } = await onSubmit(email);
    setSending(false);
    if (ok) setDone(true);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {done ? (
          <div className="text-center space-y-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto" style={{ background: 'var(--xray-good-bg)' }}>
              <CheckCircle2 className="w-9 h-9" style={{ color: 'var(--xray-good-fg)' }} />
            </div>
            <div>
              <h2 className="text-2xl font-display">{t('radiografia.email.doneTitle')}</h2>
              <p className="text-muted-foreground mt-2">{t('radiografia.email.doneSubtitle')}</p>
            </div>
            <button
              onClick={onCreateAccount}
              className="w-full py-4 bg-primary text-primary-foreground rounded-xl font-display flex items-center justify-center gap-2 hover:shadow-lg transition-all"
            >
              {t('radiografia.email.createAccount')}
              <ArrowRight className="w-4 h-4" />
            </button>
            <p className="text-xs text-muted-foreground">{t('radiografia.email.createAccountHint')}</p>
            <p className="font-display italic text-sm text-primary pt-4 border-t border-border max-w-xs mx-auto">
              {t('radiografia.email.closingLine')}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <XRayMark className="w-14 h-14 mx-auto" />
              <h2 className="text-2xl font-display">{t('radiografia.email.title')}</h2>
              <p className="text-muted-foreground">{t('radiografia.email.subtitle')}</p>
            </div>

            <div className="space-y-2 bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-3 text-sm"><FileText className="w-4 h-4 text-primary shrink-0" />{t('radiografia.email.perkReport')}</div>
              <div className="flex items-center gap-3 text-sm"><BookOpen className="w-4 h-4 text-primary shrink-0" />{t('radiografia.email.perkEbook')}</div>
            </div>

            <div className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submit()}
                placeholder={t('radiografia.email.placeholder')}
                className="w-full border border-border rounded-xl px-4 py-3 bg-background outline-none focus:border-primary text-sm"
              />
              <button
                onClick={submit}
                disabled={!valid || sending}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 font-display"
              >
                {sending ? t('radiografia.email.sending') : t('radiografia.email.submit')}
              </button>
              <p className="text-xs text-muted-foreground text-center">{t('radiografia.email.privacy')}</p>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
