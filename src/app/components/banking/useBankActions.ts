import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { apiErrorMessage } from '../../lib/apiErrors';
import type { useBanking } from '../../hooks/useBanking';
import { rememberBankReturn, type BankReturnScreen } from './bankReturn';

type Banking = ReturnType<typeof useBanking>;

/** The bank actions every screen offers the same way (Accounts, Activity,
 *  Home): start or renew consent, sync now, each with its toasts.
 *  `returnTo`: the screen to come back to once the bank flow ends (linking and
 *  the first review happen in Accounts); none = stay in Accounts. */
export function useBankActions(banking: Banking, onChanged: () => void, returnTo?: BankReturnScreen) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const fail = (res: { error: string; code?: string }, fallbackKey: string) =>
    toast.error(apiErrorMessage(t, { code: res.code, error: t(fallbackKey) }));

  /** Starts (or renews) consent: on success the browser is on its way to the bank. */
  const startConsent = async (target: { name: string; country: string } | { connectionId: string }) => {
    setConnecting(true);
    rememberBankReturn(returnTo);
    const res = await banking.connect(target, language);
    if (!res.ok) { setConnecting(false); rememberBankReturn(undefined); fail(res, 'banking.errors.connectFailed'); }
  };

  const sync = async (connectionId: string) => {
    setSyncingId(connectionId);
    const res = await banking.syncNow(connectionId);
    setSyncingId(null);
    if (!res.ok) { fail(res, 'banking.errors.syncFailed'); return; }
    onChanged();
    toast.success(t('banking.syncedOk', { count: res.written }));
    if (res.held > 0) toast.info(t('banking.heldForReview', { count: res.held }));
  };

  return { connecting, startConsent, syncingId, sync, fail };
}
