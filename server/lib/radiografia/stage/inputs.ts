// Turns raw ProfileFieldValue/ProfileDebt rows into the concrete numbers the
// stage engine (engine.ts) actually compares. Reuses computeCompleteness()
// rather than re-deriving "is this classifiable" — there's exactly one
// definition of that, in the field registry.
import { computeCompleteness } from "../fields/registry.v1.js";
import { STAGE_CONFIG_V1 } from "./config.v1.js";

export interface StageInputs {
  classifiable: boolean;
  missing: string[];
  baseMensual: number | null; // housing_payment + essentials_total, cents
  colchonDisponible: number | null; // account_balance + assets_cuasi_efectivo, cents
  cashflowNet: number | null; // income − (housing + essentials + enjoyment + non-mortgage debt payments)
  hasNonMortgageDebt: boolean;
  isInvesting: boolean;
}

export interface FieldValueRow { fieldKey: string; valueCents: number; source: string }
export interface DebtRow { kind: string; monthlyPayment: number; source: string }

// Q6 (plan §6), resolved: extracto wins for spending/debt/balance — a bank
// statement observes what actually happened, and is more reliable than a
// remembered estimate. Manual wins for income — a short statement window can
// miss irregular or multi-source income, and the user knows their own net
// better than a few months of deposits do. Both values are always stored
// (principio 3, discrepancies are an asset); this only decides which one the
// engine computes with.
const INCOME_KEYS = new Set(["income_regular", "income_floor"]);

function precedenceFor(fieldKey: string): string[] {
  return INCOME_KEYS.has(fieldKey) ? ["manual", "extracto", "derivado"] : ["extracto", "manual", "derivado"];
}

function resolveFieldValues(rows: FieldValueRow[]): Map<string, number> {
  const byField = new Map<string, FieldValueRow[]>();
  for (const r of rows) {
    if (!byField.has(r.fieldKey)) byField.set(r.fieldKey, []);
    byField.get(r.fieldKey)!.push(r);
  }
  const resolved = new Map<string, number>();
  for (const [key, group] of byField) {
    for (const source of precedenceFor(key)) {
      const hit = group.find((g) => g.source === source);
      if (hit) {
        resolved.set(key, hit.valueCents);
        break;
      }
    }
  }
  return resolved;
}

// Same precedence idea applied to a row SET rather than a single value: debts
// can't be reconciled field-by-field the way ProfileFieldValue can (they're N
// rows, not one number), so if the statement detected any debts at all, its
// view wins wholesale over the manual list — including overriding a manual
// "no tengo deudas" answer, which is exactly the kind of discrepancy this
// exists to surface rather than hide.
function resolveDebts(debts: DebtRow[]): DebtRow[] {
  const extracto = debts.filter((d) => d.source === "extracto");
  return extracto.length > 0 ? extracto : debts.filter((d) => d.source === "manual");
}

export function buildStageInputs(params: {
  fieldValues: FieldValueRow[];
  debts: DebtRow[];
  hasDebtsAnswer: boolean;
  incomeType: "regular" | "irregular";
}): StageInputs {
  const presentFieldKeys = new Set(params.fieldValues.map((r) => r.fieldKey));
  const completeness = computeCompleteness({
    presentFieldKeys,
    hasDebtsAnswer: params.hasDebtsAnswer,
    incomeType: params.incomeType,
  });

  if (!completeness.classifiable) {
    return {
      classifiable: false,
      missing: completeness.missing,
      baseMensual: null,
      colchonDisponible: null,
      cashflowNet: null,
      hasNonMortgageDebt: false,
      isInvesting: false,
    };
  }

  const values = resolveFieldValues(params.fieldValues);
  const income = (params.incomeType === "irregular" ? values.get("income_floor") : values.get("income_regular"))!;
  const housing = values.get("housing_payment")!;
  const essentials = values.get("essentials_total")!;
  const enjoyment = values.get("enjoyment_total") ?? 0;
  const accountBalance = values.get("account_balance")!;
  const cuasiEfectivo = values.get("assets_cuasi_efectivo")!;
  const investmentMonthly = values.get("investment_monthly") ?? 0;

  const excludedKinds: readonly string[] = STAGE_CONFIG_V1.debtExcludedKinds;
  const resolvedDebts = resolveDebts(params.debts);
  const nonMortgageDebts = resolvedDebts.filter((d) => !excludedKinds.includes(d.kind));
  const nonMortgageDebtMonthlyTotal = nonMortgageDebts.reduce((sum, d) => sum + d.monthlyPayment, 0);

  return {
    classifiable: true,
    missing: [],
    baseMensual: housing + essentials,
    colchonDisponible: accountBalance + cuasiEfectivo,
    // Saving/investment/giving are allocations of surplus, not "gastos" — same
    // treatment the existing analyze.ts pipeline already gives them ("savings/
    // investment transfers are NOT counted as expenses").
    cashflowNet: income - (housing + essentials + enjoyment + nonMortgageDebtMonthlyTotal),
    hasNonMortgageDebt: nonMortgageDebts.length > 0,
    isInvesting: investmentMonthly > 0,
  };
}
