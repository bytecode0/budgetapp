// Versioned field registry for the unified Radiografía onboarding
// (docs/plan-onboarding-radiografia.md §2.2). This is the ONE place that knows
// which financial fields exist, what block/step asks for them, whether
// they're required, and what the stage engine needs before it will attempt a
// classification. Validation, completeness, and the engine's predicates all
// read from here — none of them hardcode a field list of their own.
//
// Versioned in its filename (registry.v1.ts) because it changes together with
// the stage engine config it feeds: a new engine version that needs a new
// input gets a new registry version alongside it, never a silent field added
// to v1.

export type FieldBucket =
  | "ingreso"
  | "vivienda"
  | "esenciales"
  | "disfrute"
  | "ahorro"
  | "inversion"
  | "generosidad"
  | "activos";

// What the value in ProfileFieldValue.source can be — one row per (field,
// source), never overwritten (plan principio 3: discrepancies are an asset).
export type FieldSource = "manual" | "extracto" | "derivado";

export interface FieldDef {
  key: string;
  bucket: FieldBucket;
  required: boolean;
  block: 1 | 3; // which onboarding block asks for this (Bloque 1 obligatorio, Bloque 3 enriquecimiento — F10)
  unit: "cents";
  // Present only for fields the engine computes from others rather than ever
  // capturing directly — e.g. base_mensual, which plan §3.4 is explicit must
  // be ONE definition (the same magnitude as the 10/50/20/20 "esenciales"
  // bucket), not re-derived wherever it's needed.
  derivableFrom?: string[];
}

export const FIELD_REGISTRY_VERSION = 1;

export const FIELD_REGISTRY: FieldDef[] = [
  // ---- Bloque 1 — obligatorio, rápido ----
  { key: "income_regular", bucket: "ingreso", required: true, block: 1, unit: "cents" },
  // Only asked when FinancialProfile.incomeType === "irregular". What exactly
  // this represents (declared minimum? p25 of the last N months?) is Q3 —
  // still open. The field exists in the registry regardless, so the shell
  // (F3) and the wizard (F4) have somewhere to put the answer once Q3 is resolved.
  { key: "income_floor", bucket: "ingreso", required: false, block: 1, unit: "cents" },
  { key: "housing_payment", bucket: "vivienda", required: true, block: 1, unit: "cents" },
  { key: "essentials_total", bucket: "esenciales", required: true, block: 1, unit: "cents" },
  { key: "enjoyment_total", bucket: "disfrute", required: false, block: 1, unit: "cents" },
  { key: "saving_monthly", bucket: "ahorro", required: false, block: 1, unit: "cents" },
  { key: "investment_monthly", bucket: "inversion", required: false, block: 1, unit: "cents" },
  { key: "giving_monthly", bucket: "generosidad", required: false, block: 1, unit: "cents" },
  // The three buckets (plan: "opcionales-con-cero" — a user with no
  // investments answers 0 in two of these, never an extra step for it).
  { key: "account_balance", bucket: "activos", required: true, block: 1, unit: "cents" },
  { key: "assets_cuasi_efectivo", bucket: "activos", required: true, block: 1, unit: "cents" },
  { key: "assets_mercado_volatil", bucket: "activos", required: false, block: 1, unit: "cents" },
  // Persisted from day one even though no initial-stage predicate reads it
  // yet (plan §3.4: "no lo dejes fuera del esquema porque todavía no se usa").
  { key: "assets_bloqueado", bucket: "activos", required: false, block: 1, unit: "cents" },

  // Derived, never captured directly. base_mensual = vivienda + esenciales
  // (plan §3.4, Q5 resuelta) — the ONE denominator for both the colchón
  // (0.5×) and the fondo de emergencias (3×) objectives.
  {
    key: "base_mensual",
    bucket: "esenciales",
    required: false,
    block: 1,
    unit: "cents",
    derivableFrom: ["housing_payment", "essentials_total"],
  },
];

// Debts don't fit a single fieldKey — they're N rows with their own kind/APR,
// living in ProfileDebt, not ProfileFieldValue. This flag is the OTHER half of
// "insumos mínimos incluye deudas (o 'no tengo')": a profile satisfies the
// debts input either by having ≥1 ProfileDebt row, or by explicitly recording
// that the user pressed "No tengo deudas" (plan F1.4's skip button) — the
// engine must never confuse "hasn't answered yet" with "has zero debt".
export const DEBTS_NONE_FLAG = "debts_confirmed_none";

// Minimum inputs the stage engine needs before it will attempt classification
// (plan §2.2). Anything else enriches the picture but isn't load-bearing for
// a first classification. Debts are checked separately (see completeness()).
export const MIN_INPUTS_FOR_STAGE: readonly string[] = [
  "income_regular",
  "essentials_total",
  "housing_payment",
  "account_balance",
  "assets_cuasi_efectivo",
];

export function fieldsForBlock(block: 1 | 3): FieldDef[] {
  return FIELD_REGISTRY.filter((f) => f.block === block);
}

export function requiredFields(): FieldDef[] {
  return FIELD_REGISTRY.filter((f) => f.required);
}

export function findField(key: string): FieldDef | undefined {
  return FIELD_REGISTRY.find((f) => f.key === key);
}

export interface CompletenessInput {
  /** fieldKeys with at least one ProfileFieldValue row, any source. */
  presentFieldKeys: Set<string>;
  /** True if the profile has ≥1 ProfileDebt row OR the DEBTS_NONE_FLAG field is present. */
  hasDebtsAnswer: boolean;
}

export interface Completeness {
  pct: number; // 0–1
  missing: string[]; // human-checkable field keys (and "debts" if unanswered), for the "no pudimos calcularlo" block (principio 5)
  classifiable: boolean; // true iff every MIN_INPUTS_FOR_STAGE key is present AND debts are answered
}

/** Calculated, never stored (plan §2.1: "Completitud calculada, no almacenada"). */
export function computeCompleteness(input: CompletenessInput): Completeness {
  const required = requiredFields().map((f) => f.key);
  const missing = required.filter((k) => !input.presentFieldKeys.has(k));
  if (!input.hasDebtsAnswer) missing.push("debts");

  const minInputsMissing = MIN_INPUTS_FOR_STAGE.filter((k) => !input.presentFieldKeys.has(k));
  const classifiable = minInputsMissing.length === 0 && input.hasDebtsAnswer;

  const totalRequired = required.length + 1; // +1 for the debts answer
  const pct = totalRequired > 0 ? (totalRequired - missing.length) / totalRequired : 1;

  return { pct, missing, classifiable };
}
