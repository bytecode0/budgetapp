/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in local dev; "false" in production (Épica 0 — see docs/scope-release.md). */
  readonly VITE_ENABLE_BUDGETAPP: string;
  /** Gates the new /radiografia/onboarding flow (plan F3+) while it's built out — coexists with the live /radiografia flow, never replaces it until it's ready to cut over. */
  readonly VITE_ENABLE_ONBOARDING_V2: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
