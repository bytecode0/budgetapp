import { useState } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Sprout } from 'lucide-react';
import { toast } from 'sonner';
import { useMoney } from '../onboarding/useMoney';
import { useCelebrations, type Celebration } from '../hooks/useCelebrations';

function monthName(key: string, locale: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long' });
}

// "Celebrar los hitos" on Home (LPBETA-13): one sober card, the biggest
// celebration not seen yet, a short sentence and "Seguir". "Seguir" marks it
// seen for this person on every device; the next one, if any, shows on the
// next visit — never a queue in one sitting. Nothing is ever said when
// something isn't reached.
export function CelebrationCard() {
  const { t } = useTranslation();
  const { fmt, locale } = useMoney();
  const { celebrations, markSeen } = useCelebrations();
  const [closed, setClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  const c: Celebration | undefined = celebrations[0];
  // After "Seguir" the card goes for this visit; it isn't replaced by the next.
  if (!c || closed) return null;

  const sentence = (() => {
    switch (c.kind) {
      case 'debtPaidOff':
        return c.amount !== null
          ? t('celebrations.debtPaidOff', { name: c.name, amount: fmt(c.amount) })
          : t('celebrations.debtPaidOffNoAmount', { name: c.name });
      case 'emergencyFundDone': return t('celebrations.emergencyFundDone');
      case 'planDone': return t('celebrations.planDone', { title: c.title });
      case 'planMilestone':
        return c.pct !== null
          ? t('celebrations.planMilestonePct', { title: c.title, pct: c.pct })
          : t('celebrations.planMilestoneAmount', { title: c.title, amount: fmt(c.amount ?? 0) });
      case 'planFirstContribution': return t('celebrations.planFirstContribution', { title: c.title });
      case 'payYourselfFirstFirst': return t('celebrations.payYourselfFirstFirst');
      case 'payYourselfFirstStreak': return t('celebrations.payYourselfFirstStreak', { count: c.months });
      case 'monthWithinBudget': return t('celebrations.monthWithinBudget', { month: monthName(c.month, locale) });
    }
  })();

  const onContinue = async () => {
    setSaving(true);
    const result = await markSeen(c.key);
    setSaving(false);
    if (result === 'failed') toast.error(t('celebrations.saveFailed'));
    else setClosed(true);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      aria-labelledby="celebration-heading"
      className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4"
    >
      <div className="w-10 h-10 rounded-xl bg-reed-soft text-reed flex items-center justify-center shrink-0" aria-hidden="true">
        <Sprout className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        <div className="space-y-1">
          <p className="text-xs text-reed font-medium">{t('celebrations.label')}</p>
          <h2 id="celebration-heading" className="font-display text-lg">{sentence}</h2>
        </div>
        <button
          onClick={onContinue}
          disabled={saving}
          className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('celebrations.continue')}
        </button>
      </div>
    </motion.section>
  );
}
