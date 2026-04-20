import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Heart, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { InviteDetails } from '../hooks/usePartner';

interface Props {
  token: string;
  invite: InviteDetails;
  onAccept: (token: string) => Promise<{ error?: string; linkedTo?: { name: string; email: string } }>;
  onDismiss: () => void;
}

export function PartnerInviteAccept({ token, invite, onAccept, onDismiss }: Props) {
  const { t } = useTranslation();
  const [accepting, setAccepting] = useState(false);
  const [done, setDone] = useState(false);
  const [linkedName, setLinkedName] = useState('');
  const [error, setError] = useState('');

  const handleAccept = async () => {
    setAccepting(true);
    setError('');
    const result = await onAccept(token);
    setAccepting(false);
    if (result.error) {
      setError(result.error);
    } else {
      setLinkedName(result.linkedTo?.name ?? invite.senderName);
      setDone(true);
    }
  };

  const shareItems = [
    t('partnerInvite.shareExpenses'),
    t('partnerInvite.sharePlans'),
    t('partnerInvite.shareAllocations'),
    t('partnerInvite.shareReviews'),
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        className="bg-card border border-border rounded-3xl p-8 w-full max-w-sm shadow-2xl"
      >
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center space-y-4"
            >
              <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <h2 className="font-display text-2xl mb-1">{t('partnerInvite.linked')}</h2>
                <p className="text-muted-foreground text-sm">
                  {t('partnerInvite.linkedDesc', { name: linkedName })}
                </p>
              </div>
              <button
                onClick={onDismiss}
                className="w-full py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors"
              >
                {t('partnerInvite.startExploring')}
              </button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-violet-500/20 rounded-2xl flex items-center justify-center">
                  <Heart className="w-6 h-6 text-primary" />
                </div>
                <button
                  onClick={onDismiss}
                  className="w-8 h-8 flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div>
                <h2 className="font-display text-2xl mb-2">{t('partnerInvite.title')}</h2>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {t('partnerInvite.invited', { name: invite.senderName, email: invite.senderEmail })}
                </p>
              </div>

              <div className="bg-muted/50 rounded-2xl p-4 space-y-2 text-sm">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground mb-3">{t('partnerInvite.onceLinked')}</p>
                {shareItems.map(item => (
                  <div key={item} className="flex items-center gap-2 text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-950/20 px-3 py-2 rounded-xl">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onDismiss}
                  className="flex-1 py-3 border border-border rounded-xl text-sm hover:bg-muted transition-colors"
                >
                  {t('partnerInvite.decline')}
                </button>
                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="flex-1 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-xl hover:shadow-md transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                >
                  {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Heart className="w-4 h-4" />}
                  {t('partnerInvite.accept')}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
