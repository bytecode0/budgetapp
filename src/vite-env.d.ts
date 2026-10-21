/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in local dev; "false" in production (Épica 0 — see docs/scope-release.md). */
  readonly VITE_ENABLE_BUDGETAPP: string;
  /** Plausible site domain (Épica 4). Undefined in local dev — analytics.ts skips injecting the script when unset, never a placeholder domain. */
  readonly VITE_PLAUSIBLE_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
