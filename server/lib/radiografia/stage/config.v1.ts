// Versioned stage-engine thresholds (plan §3.1: "configuración versionada, no
// ifs hardcodeados"). A .ts constant rather than a .json file — same
// JSON-serializable shape (still exactly what would go in
// StageEngineConfig.config once that table is actually wired to load from
// DB), but avoids resolveJsonModule/import-assertion friction across
// tsx/node versions for a single, small, git-reviewed object.
//
// Deliberately NOT a generic predicate-tree interpreter (plan §3.2 sketched
// one with `all`/`any`/`between` operators). The 5 stages the user defined
// are a small, fully-specified, ORDERED decision tree — building a generic
// rule DSL for one caller would be speculative generality. If a real need
// shows up later (e.g. A/B testing thresholds without a deploy via
// StageEngineConfig), that's a clean follow-up; today the numbers below are
// the only thing that needs to change without touching engine.ts.
export const STAGE_CONFIG_V1 = {
  version: 1,
  // colchón = 0.5× base_mensual (suelo protegido Y sugerencia — solo se puede
  // subir, nunca bajar). fondo de emergencia = 3× el mismo base_mensual.
  // Ambos comparten el mismo denominador (plan Q5, ya resuelto) y el mismo
  // numerador (colchon_disponible = account_balance + assets_cuasi_efectivo,
  // NUNCA assets_mercado_volatil ni assets_bloqueado).
  colchonMultiple: 0.5,
  fondoMultiple: 3,
  // Una hipoteca es un compromiso a largo plazo asegurado, no deuda de
  // consumo — mismo criterio que ya aplica server/lib/xray/debts.ts al
  // excluirla de debts.monthlyTotal. "Libre de deudas" (Etapas 3+) se evalúa
  // solo sobre ProfileDebt con kind fuera de esta lista.
  debtExcludedKinds: ["mortgage"],
} as const;
