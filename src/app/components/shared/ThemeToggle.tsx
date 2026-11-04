import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Always-visible light/dark switch (LPBETA-18): in the mobile top bar and the
// desktop sidebar, never only in Settings. One tap; the choice is saved for
// the person on the server.
export function ThemeToggle({ darkMode, onToggle, className = '' }: {
  darkMode: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = darkMode ? t('theme.switchToLight') : t('theme.switchToDark');
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
