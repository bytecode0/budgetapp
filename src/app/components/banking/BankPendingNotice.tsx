import { useState } from 'react';
import { motion } from 'motion/react';
import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useBanking } from '../../hooks/useBanking';
import { pendingReviews, type BankReviewTarget } from '../../../../shared/bankStrip';
import { BankStatusRetry } from './BankStatusRetry';
import { BankReview } from './BankReview';
import { PendingText } from './BankStrip';

/** Home's notice when bank movements wait for the user's review; nothing
 *  otherwise. Only the connection's owner reviews, so a partner never sees it. */
export function BankPendingNotice({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const banking = useBanking();
  const [queue, setQueue] = useState<BankReviewTarget[] | null>(null);

  const { targets, count, bank } = pendingReviews(banking.enabled ? banking.connections : [], new Date());
  // The list couldn't be read: say so (with a retry) rather than drop the notice.
  if (banking.availability === 'check_failed') return <BankStatusRetry onRetry={banking.checkStatus} />;

  return (
    <>
      {targets.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.11 }}
          className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-2xl px-5 py-4"
        >
          <ListChecks className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              <PendingText count={count} bank={bank} />
            </p>
            <p className="text-sm text-amber-600/70 dark:text-amber-400/70 mt-0.5">{t('banking.homePendingDesc')}</p>
          </div>
          <button
            onClick={() => setQueue(targets)}
            className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs font-display hover:bg-amber-500/20 transition-colors shrink-0"
          >
            {t('banking.stripReview')}
          </button>
        </motion.div>
      )}
      <BankReview
        queue={queue}
        onClose={() => setQueue(null)}
        onDone={onChanged}
        preview={banking.preview}
        confirm={banking.confirm}
      />
    </>
  );
}
