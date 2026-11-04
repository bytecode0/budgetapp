import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Always-visible light/dark switch (LPBETA-18): in the mobile top bar, the
// desktop sidebar and the onboarding header, never only in Settings. One tap;
// the choice is saved for the person on the server. `showLabel` adds the
// mode's name next to the icon where there is room (the sidebar).
export function ThemeToggle({ darkMode, onToggle, showLabel = false, className = '' }: {
  darkMode: boolean;
  onToggle: () => void;
  showLabel?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = darkMode ? t('theme.switchToLight') : t('theme.switchToDark');
  const Icon = darkMode ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={`h-11 shrink-0 rounded-full border border-line-strong bg-card text-foreground hover:bg-muted transition-colors inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${showLabel ? 'px-4' : 'w-11'} ${className}`}
    >
      <Icon className="w-5 h-5" />
      {showLabel && <span className="text-sm font-medium">{darkMode ? t('theme.lightLabel') : t('theme.darkLabel')}</span>}
    </button>
  );
}
