// Plausible (Épica 4, docs/scope-release.md) — chosen over Google Analytics
// specifically because it needs no cookie banner, which matters for the
// visits metric itself (a consent banner costs 10–30% of registered visits
// in the EU). Scoped to the Radiografía + report pages only: mount this from
// OnboardingFlow.tsx / ReportPage.tsx, never from App.tsx globally — the same
// index.html also serves the authenticated BudgetApp, which stays untouched.
//
// Domain comes from VITE_PLAUSIBLE_DOMAIN. Unset in local dev on purpose:
// there is no Plausible account for this project yet (that's the product
// owner's own action, not something an agent can create), so the script is
// simply not injected rather than pointed at a placeholder domain.
const DOMAIN = import.meta.env.VITE_PLAUSIBLE_DOMAIN;

let injected = false;

export function ensurePlausibleLoaded(): void {
  if (injected || !DOMAIN || typeof document === 'undefined') return;
  injected = true;

  const script = document.createElement('script');
  script.defer = true;
  script.dataset.domain = DOMAIN;
  script.src = 'https://plausible.io/js/script.js';
  document.head.appendChild(script);

  // The standard Plausible queue shim: calls made before the real script
  // finishes loading (or when it's absent entirely, e.g. an ad blocker)
  // queue silently instead of throwing.
  type PlausibleFn = { (...args: unknown[]): void; q?: unknown[] };
  const w = window as unknown as { plausible?: PlausibleFn };
  const fn: PlausibleFn = function (...args: unknown[]) {
    (fn.q = fn.q || []).push(args);
  };
  w.plausible = w.plausible || fn;
}

// `props` must never carry an amount or an email (CLAUDE.md: "Never send
// financial amounts or email addresses as event properties") — every call
// site in this codebase only ever passes a step number.
export function trackPlausible(event: string, props?: Record<string, string | number>): void {
  if (!DOMAIN || typeof window === 'undefined') return;
  const w = window as unknown as { plausible?: (event: string, opts?: { props?: Record<string, string | number> }) => void };
  w.plausible?.(event, props ? { props } : undefined);
}
