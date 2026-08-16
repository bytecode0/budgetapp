/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" in local dev; "false" in production (Épica 0 — see docs/scope-release.md). */
  readonly VITE_ENABLE_BUDGETAPP: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
