import { RefreshCw, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Banking's status couldn't be read (network, server error): say so with a
 *  retry, instead of hiding banking as if it weren't available. */
export function BankStatusRetry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground flex items-center gap-2 min-w-0">
        <WifiOff className="w-4 h-4 shrink-0" />
        {t('banking.statusCheckFailed')}
      </p>
      <button
        onClick={onRetry}
        className="px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-xs flex items-center gap-1.5 shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {t('banking.retry')}
      </button>
    </div>
  );
}
