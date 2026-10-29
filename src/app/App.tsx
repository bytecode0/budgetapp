import { lazy, Suspense } from 'react';
import type { LegalPageKind } from './components/LegalPage';

const BudgetApp = lazy(() => import('./BudgetApp').then((m) => ({ default: m.BudgetApp })));
const LegalPage = lazy(() => import('./components/LegalPage').then((m) => ({ default: m.LegalPage })));

// Public pages served by path (vercel.json rewrites every path to index.html;
// there is no router). Everything else is the authenticated app.
const LEGAL_PATHS: Record<string, LegalPageKind> = { '/privacy': 'privacy', '/terms': 'terms' };

function LoadingSpinner() {
  return (
    <div className="size-full min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const legalPage = LEGAL_PATHS[window.location.pathname.replace(/\/+$/, '')];
  return (
    <Suspense fallback={<LoadingSpinner />}>
      {legalPage ? <LegalPage page={legalPage} /> : <BudgetApp />}
    </Suspense>
  );
}
