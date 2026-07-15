// Server-side labels for the Radiografía (category names, pillars, stages,
// opportunity copy). Mirrors the frontend i18n `radiografia.*` so the PDF report
// and hydrated allocations read the same as the on-screen experience.

export type Lang = "es" | "en";

const CATEGORY: Record<string, { en: string; es: string }> = {
  supermarket: { en: "Groceries", es: "Supermercado" },
  delivery: { en: "Food delivery", es: "Comida a domicilio" },
  restaurants: { en: "Restaurants", es: "Restaurantes" },
  transport: { en: "Transport", es: "Transporte" },
  fuel: { en: "Fuel", es: "Combustible" },
  subscriptions: { en: "Subscriptions", es: "Suscripciones" },
  utilities: { en: "Utilities", es: "Suministros" },
  shopping: { en: "Shopping", es: "Compras" },
  health: { en: "Health", es: "Salud" },
  fitness: { en: "Fitness", es: "Gimnasio" },
  insurance: { en: "Insurance", es: "Seguros" },
  housing: { en: "Housing", es: "Vivienda" },
  education: { en: "Education", es: "Educación" },
  travel: { en: "Travel", es: "Viajes" },
  cash: { en: "Cash", es: "Efectivo" },
  other: { en: "Other", es: "Otros" },
};

const PILLAR: Record<string, { en: string; es: string }> = {
  savings: { en: "Savings", es: "Ahorro" },
  structure: { en: "Structure", es: "Estructura" },
  leaks: { en: "Leaks", es: "Fugas" },
  commitments: { en: "Commitments", es: "Compromisos" },
  stability: { en: "Stability", es: "Estabilidad" },
};

const STAGE: Record<string, { en: string; es: string }> = {
  building: { en: "Building", es: "En construcción" },
  balancing: { en: "Finding balance", es: "Buscando equilibrio" },
  growing: { en: "Growing", es: "En crecimiento" },
  solid: { en: "Solid", es: "Sólido" },
};

export function categoryLabel(key: string, lang: Lang): string {
  return CATEGORY[key]?.[lang] ?? key;
}
export function pillarLabel(key: string, lang: Lang): string {
  return PILLAR[key]?.[lang] ?? key;
}
export function stageLabel(stage: string, lang: Lang): string {
  return STAGE[stage]?.[lang] ?? stage;
}

// Opportunity copy. `money` formats a euro amount; `params` come from the
// analyzer. Returns { title, detail } already interpolated.
export function opportunityText(
  id: string,
  params: Record<string, number>,
  annualSaving: number,
  lang: Lang,
  money: (n: number) => string,
): { title: string; detail: string } {
  const saving = money(annualSaving);
  const es: Record<string, { title: string; detail: string }> = {
    cut_dining_20: { title: "Comer fuera un poco menos", detail: `Reducir un ${params.pct ?? 20}% en restaurantes y comida a domicilio liberaría unos ${saving} al año.` },
    halve_ant: { title: "Domar tus gastos hormiga", detail: `Reducir a la mitad esos pequeños gastos frecuentes ahorraría unos ${saving} al año.` },
    review_subscriptions: { title: `Revisa tus ${params.count ?? 0} suscripciones`, detail: `Cancelar las que no usas podría recuperar unos ${saving} al año.` },
    emergency_fund: { title: "Crea tu colchón de seguridad", detail: `A tu ritmo actual, un fondo de emergencia de 3 meses (${money(params.target ?? 0)}) estaría completo en unos ${params.months ?? 0} meses.` },
  };
  const en: Record<string, { title: string; detail: string }> = {
    cut_dining_20: { title: "Eat out a little less", detail: `Reducing restaurants & delivery by ${params.pct ?? 20}% would free up around ${saving} a year.` },
    halve_ant: { title: "Tame your ant expenses", detail: `Halving those small, frequent spends would save about ${saving} a year.` },
    review_subscriptions: { title: `Review your ${params.count ?? 0} subscriptions`, detail: `Cancelling the ones you don't use could recover about ${saving} a year.` },
    emergency_fund: { title: "Build your safety net", detail: `At your current pace, a 3-month emergency fund (${money(params.target ?? 0)}) would be complete in about ${params.months ?? 0} months.` },
  };
  return (lang === "es" ? es : en)[id] ?? { title: id, detail: "" };
}
