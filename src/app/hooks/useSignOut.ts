// Sign out from the navigation or Settings (LPBETA-29). No confirmation:
// signing out deletes nothing. `signingOut` disables the button meanwhile.
// AuthContext.logout always ends the local session, even if the request
// fails; then the person is told so instead of the usual confirmation.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

export function useSignOut() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    const { ok } = await logout();
    setSigningOut(false);
    if (ok) toast.success(t('account.signedOut'));
    else toast.error(t('account.signOutFailed'));
  };

  return { signOut, signingOut };
}
