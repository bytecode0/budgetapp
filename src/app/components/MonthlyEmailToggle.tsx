import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'motion/react';
import { Mail } from 'lucide-react';
import { toast } from 'sonner';

// Settings → the monthly email "Tu mes en Remanso" (LPBETA-12), on or off.
// The person's own setting (GET/PATCH /api/insights/monthly-email); the email
// itself also carries a link to turn it off without signing in.
export function MonthlyEmailToggle() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/insights/monthly-email', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(json => { if (alive && typeof json?.data?.enabled === 'boolean') setEnabled(json.data.enabled); })
      .catch(() => { /* the row just doesn't show */ });
    return () => { alive = false; };
  }, []);

  if (enabled === null) return null;

  const toggle = async () => {
    const next = !enabled;
    setSaving(true);
    try {
      const res = await fetch('/api/insights/monthly-email', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('monthly-email failed');
      setEnabled(next);
      toast.success(next ? t('settings.monthlyEmail.on') : t('settings.monthlyEmail.off'));
    } catch {
      toast.error(t('settings.monthlyEmail.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-pool-soft rounded-lg flex items-center justify-center shrink-0">
            <Mail className="w-5 h-5 text-pool" />
          </div>
          <div>
            <p id="monthly-email-label" className="font-display">{t('settings.monthlyEmail.title')}</p>
            <p className="text-sm text-muted-foreground">{t('settings.monthlyEmail.subtitle')}</p>
          </div>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-labelledby="monthly-email-label"
          onClick={toggle}
          disabled={saving}
          className={`relative w-14 h-7 rounded-full transition-colors shrink-0 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${enabled ? 'bg-primary' : 'bg-muted'}`}
        >
          <motion.div
            animate={{ x: enabled ? 28 : 2 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-1 w-5 h-5 bg-white rounded-full shadow-md"
          />
        </button>
      </div>
    </div>
  );
}
