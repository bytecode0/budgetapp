import { Trans } from 'react-i18next';

const linkClass = 'underline hover:text-foreground transition-colors';

// "By signing up you accept the Terms and the Privacy policy", with both
// linked to the public pages (/terms, /privacy). They open in a new tab so a
// half-filled form isn't lost.
export function TermsNotice({ i18nKey }: { i18nKey: 'auth.login.terms' | 'auth.signup.terms' }) {
  return (
    <Trans
      i18nKey={i18nKey}
      components={{
        terms: <a href="/terms" target="_blank" rel="noopener noreferrer" className={linkClass} />,
        privacy: <a href="/privacy" target="_blank" rel="noopener noreferrer" className={linkClass} />,
      }}
    />
  );
}
