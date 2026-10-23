import { lazy, Suspense } from 'react';

const BudgetApp = lazy(() => import('./BudgetApp').then((m) => ({ default: m.BudgetApp })));

function LoadingSpinner() {
  return (
    <div className="size-full min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BudgetApp />
    </Suspense>
  );
}
