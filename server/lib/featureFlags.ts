// Épica 0 (docs/scope-release.md): the BudgetApp is not launching 12 Sep 2026 —
// only the Radiografía is public. Same env var name as the frontend's
// `VITE_ENABLE_BUDGETAPP` (Node ignores the VITE_ prefix; it's a plain
// process.env read here) so there's exactly one flag to set correctly per
// environment, not two that can drift apart.
export function budgetAppEnabled(): boolean {
  return process.env.VITE_ENABLE_BUDGETAPP === "true";
}
