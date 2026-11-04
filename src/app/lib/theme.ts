// Light / dark theme (LPBETA-27). The person's choice is stored on the server
// (their own UserSettings.darkMode), so it follows them to every device. This
// device keeps a copy only to paint the right theme before the app loads
// (index.html reads it before first paint); the server's value always wins.
export const THEME_STORAGE_KEY = 'remanso-theme';

// Same values as --surface in src/styles/theme.css (the browser bar's colour).
const THEME_COLOR = { light: '#F3F6F4', dark: '#0E1B19' } as const;

export function cachedDarkMode(): boolean {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

export function applyDarkMode(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, dark ? 'dark' : 'light');
  } catch {
    // Private mode or blocked storage: the server still has the choice.
  }
}
