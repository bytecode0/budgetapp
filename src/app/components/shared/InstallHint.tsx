import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Smartphone, X } from 'lucide-react';
import { installHint } from '../../../../shared/install';
import {
  dismissInstallHint,
  hasInstallPrompt,
  installHintDismissed,
  isStandalone,
  promptInstall,
  subscribeInstallPrompt,
} from '../../lib/installPrompt';

// "Install Remanso on your phone" (LPBETA-11): a small notice at the top of the
// signed-in app, until it is installed or closed on this device.
export function InstallHint() {
  const { t } = useTranslation();
  const canPrompt = useSyncExternalStore(subscribeInstallPrompt, hasInstallPrompt);
  const [dismissed, setDismissed] = useState(installHintDismissed);

  const hint = installHint({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandalone(),
    dismissed,
    canPrompt,
  });
  if (!hint) return null;

  const close = () => {
    dismissInstallHint();
    setDismissed(true);
  };
  const install = async () => {
    if (await promptInstall()) close();
  };

  return (
    <div className="mb-6 bg-pool-soft text-ink rounded-2xl p-4 flex items-start gap-3">
      <Smartphone className="w-5 h-5 text-pool shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-semibold">{t('install.title')}</p>
        {hint === 'ios' ? (
          <ol className="text-sm text-ink-muted list-decimal pl-5 space-y-0.5">
            <li>{t('install.iosStep1')}</li>
            <li>{t('install.iosStep2')}</li>
          </ol>
        ) : (
          <>
            <p className="text-sm text-ink-muted">{t('install.promptBody')}</p>
            <button
              onClick={install}
              className="mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors text-sm"
            >
              {t('install.installButton')}
            </button>
          </>
        )}
      </div>
      <button
        onClick={close}
        aria-label={t('install.dismiss')}
        className="p-1 -m-1 rounded-lg text-ink-muted hover:text-ink transition-colors shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
