import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';

// Code-split the Radiografía onboarding (and its recharts-heavy subtree) into
// its own chunk — most authenticated users never hit /radiografia, so it
// shouldn't inflate the main bundle.
// The Radiografía onboarding (plan docs/plan-onboarding-radiografia.md) —
// the only flow at /radiografia now. It briefly coexisted with the old
// upload-first flow (XRayFlow) behind a flag while being built; that flow
// has been removed.
const OnboardingFlow = lazy(() =>
  import('../radiografia/onboarding/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow }))
);

// Épica 0 (docs/scope-release.md): the BudgetApp is not launching 12 Sep 2026 —
// only the Radiografía is public. `import.meta.env.VITE_ENABLE_BUDGETAPP` is
// inlined by Vite as a string literal at build time; when it's statically
// "false" (production), the branch below is unreachable and Rollup eliminates
// this dynamic import — and everything BudgetApp.tsx pulls in — from the
// production bundle entirely. It doesn't just hide behind a check, it's gone.
const budgetAppEnabled = import.meta.env.VITE_ENABLE_BUDGETAPP === 'true';

const BudgetApp = budgetAppEnabled
  ? lazy(() => import('./BudgetApp').then((m) => ({ default: m.BudgetApp })))
  : null;

function LoadingSpinner() {
  return (
    <div className="size-full min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

// Shown for any non-Radiografía path when the BudgetApp is disabled in this
// build. It isn't a hidden route — with the flag off, BudgetApp.tsx and
// everything it imports genuinely doesn't exist in dist/, so this is the only
// possible outcome for /dashboard, /login, /plans, etc. A true HTTP 404 status
// for those paths also depends on the static-hosting/SPA-fallback config,
// which is outside this repo's frontend code.
function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="size-full min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-display">{t('notFound.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('notFound.body')}</p>
      </div>
    </div>
  );
}

export default function App() {
  // Public, unauthenticated lead-magnet flow. Checked before the authenticated
  // app mounts so its auth-only data hooks never fire for anonymous visitors.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/radiografia')) {
    // No LanguageProvider here: it persists the language to localStorage, which
    // would leak into the authenticated app. OnboardingFlow forces Spanish at
    // runtime (the lead magnet's audience) without touching the saved preference.
    return (
      <>
        <Toaster richColors position="top-right" />
        <Suspense fallback={<LoadingSpinner />}>
          <OnboardingFlow />
        </Suspense>
      </>
    );
  }

  if (!BudgetApp) {
    return <NotFound />;
  }

  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BudgetApp />
    </Suspense>
  );
}
