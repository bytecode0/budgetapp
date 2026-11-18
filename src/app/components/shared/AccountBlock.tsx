// Who is signed in and a way out, pinned at the foot of the desktop sidebar
// and the mobile menu (LPBETA-29). Neutral ink, not red: signing out deletes
// nothing.
import { useTranslation } from 'react-i18next';
import { Loader2, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useSignOut } from '../../hooks/useSignOut';

export function AccountBlock() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { signOut, signingOut } = useSignOut();
  if (!user) return null;

  const initial = (user.name?.trim() || user.email || '?').charAt(0).toUpperCase();

  return (
    <div className="p-4 border-t border-border space-y-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 bg-pool-soft text-pool rounded-full flex items-center justify-center shrink-0 overflow-hidden">
          {user.image ? (
            <img src={user.image} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          ) : (
            <span className="font-display">{initial}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {user.name && <p className="text-sm font-display truncate">{user.name}</p>}
          {user.email && <p className="text-xs text-muted-foreground truncate" title={user.email}>{user.email}</p>}
        </div>
      </div>
      <button
        onClick={signOut}
        disabled={signingOut}
        aria-busy={signingOut}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border rounded-xl hover:bg-muted transition-colors text-sm text-foreground disabled:opacity-50"
      >
        {signingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
        {t('account.signOut')}
      </button>
    </div>
  );
}
