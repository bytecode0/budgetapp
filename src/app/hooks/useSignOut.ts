// Sign out from the navigation or Settings (LPBETA-29). No confirmation:
// signing out deletes nothing. `signingOut` (shared by every button, from
// AuthContext) disables the buttons meanwhile. AuthContext.logout always ends
// the local session, even if the request fails; then the person is told so
// instead of the usual confirmation.
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';

export function useSignOut() {
  const { t } = useTranslation();
  const { logout, signingOut } = useAuth();

  const signOut = async () => {
    const result = await logout();
    if (!result) return; // another button's sign-out reports it
    if (result.ok) toast.success(t('account.signedOut'));
    else toast.error(t('account.signOutFailed'));
  };

  return { signOut, signingOut };
}
