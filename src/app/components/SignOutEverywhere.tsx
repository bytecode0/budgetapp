// Settings → "Sign out on every device" (LPBETA-21). POST /api/auth/logout-all
// ends every session of the account and gives this device a fresh cookie, so
// the person stays signed in here. Self-contained so PlanningSettings only
// renders it.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { ChevronRight, Loader2, MonitorSmartphone, X } from 'lucide-react';

export function SignOutEverywhere() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/logout-all', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error('logout-all failed');
      setOpen(false);
      toast.success(t('settings.signOutAll.done'));
    } catch {
      toast.error(t('settings.signOutAll.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.59 }}
      className="bg-card border border-border rounded-2xl p-6"
    >
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center shrink-0">
            <MonitorSmartphone className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">{t('settings.signOutAll.button')}</p>
            <p className="text-sm text-muted-foreground">{t('settings.signOutAll.subtitle')}</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-scrim flex items-end md:items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget && !busy) setOpen(false); }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="sign-out-all-title"
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 id="sign-out-all-title" className="text-2xl font-display">{t('settings.signOutAll.title')}</h2>
                <button onClick={() => setOpen(false)} disabled={busy} aria-label={t('settings.signOutAll.cancel')} className="p-1.5 hover:bg-muted rounded-lg transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground">{t('settings.signOutAll.body')}</p>
              <button
                onClick={handleConfirm}
                disabled={busy}
                className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {t('settings.signOutAll.confirm')}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
