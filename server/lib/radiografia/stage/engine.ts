// The stage evaluator — a pure function, recomputed from stored inputs every
// time (FinancialProfile.stageCache is a cache, never the source of truth;
// plan principio 4). Order matters: this is a strict decision tree, not a
// set of independent predicates — e.g. "sin colchón" (Etapa 1) always wins
// over "sin deudas" (Etapa 3+), even for someone who happens to have both no
// debt AND no colchón yet.
import type { StageInputs } from "./inputs.js";
import { STAGE_CONFIG_V1 } from "./config.v1.js";

export type StageId = "cimientos" | "liberacion" | "terreno_firme" | "fortaleza" | "multiplicacion";

// The negative-cashflow case inside Etapa 1 (plan §3.4: "flujo de caja
// negativo... con meta propia, no la meta de colchón"). Still Etapa 1 — this
// only changes which goal copy is shown, never a stage of its own.
export type BranchId = "cerrando_la_brecha";

export interface StageResult {
  classifiable: boolean;
  missing: string[];
  stageId: StageId | null;
  branchId: BranchId | null;
}

export function evaluateStage(inputs: StageInputs): StageResult {
  if (!inputs.classifiable) {
    return { classifiable: false, missing: inputs.missing, stageId: null, branchId: null };
  }

  const base = inputs.baseMensual!;
  const colchon = inputs.colchonDisponible!;
  const hasColchon = colchon >= STAGE_CONFIG_V1.colchonMultiple * base;
  const hasFondo = colchon >= STAGE_CONFIG_V1.fondoMultiple * base;

  if (!hasColchon) {
    const branchId: BranchId | null = inputs.cashflowNet !== null && inputs.cashflowNet < 0 ? "cerrando_la_brecha" : null;
    return { classifiable: true, missing: [], stageId: "cimientos", branchId };
  }
  if (inputs.hasNonMortgageDebt) {
    return { classifiable: true, missing: [], stageId: "liberacion", branchId: null };
  }
  if (!hasFondo) {
    return { classifiable: true, missing: [], stageId: "terreno_firme", branchId: null };
  }
  if (!inputs.isInvesting) {
    return { classifiable: true, missing: [], stageId: "fortaleza", branchId: null };
  }
  return { classifiable: true, missing: [], stageId: "multiplicacion", branchId: null };
}
