// "Your account will be deleted on …" on every screen while a deletion
// request is pending (LPBETA-09), with the way back. Renders nothing otherwise.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Clock, Loader2 } from 'lucide-react';
import { useAccountDeletion } from '../hooks/useAccountDeletion';
import { formatDeletionDate } from './AccountDataPanel';

export function DeletionBanner() {
  const { t, i18n } = useTranslation();
  const { deletion, cancel } = useAccountDeletion();
  const [cancelling, setCancelling] = useState(false);
  if (!deletion) return null;

  const handleCancel = async () => {
    setCancelling(true);
    const result = await cancel();
    setCancelling(false);
    if ('error' in result) toast.error(t(result.code === 'deletion_in_progress' ? 'account.delete.inProgress' : 'account.genericError'));
    else toast.success(t('account.delete.cancelled'));
  };

  return (
    <div role="status" className="mb-6 bg-sun-soft text-sun-ink rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-2 flex-1 text-sm">
        <Clock className="w-5 h-5 shrink-0 mt-0.5" />
        <p>
          <span className="font-semibold">{t('account.delete.pendingTitle', { date: formatDeletionDate(deletion.dueAt, i18n.language) })}</span>{' '}
          {t('account.delete.pendingBody')}
        </p>
      </div>
      <button
        onClick={handleCancel}
        disabled={cancelling}
        className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50 shrink-0"
      >
        {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
        {t('account.delete.cancel')}
      </button>
    </div>
  );
}
