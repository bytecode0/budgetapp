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
  debtLoad: { en: "Committed future", es: "Futuro comprometido" },
};

// Score bands. Kept for the numeric read-out; the user-facing identity is the
// ARCHETYPE below, which is computed on its own axes (see archetype.ts).
const STAGE: Record<string, { en: string; es: string }> = {
  building: { en: "Building", es: "En construcción" },
  balancing: { en: "Finding balance", es: "Buscando equilibrio" },
  growing: { en: "Growing", es: "En crecimiento" },
  solid: { en: "Solid", es: "Sólido" },
};

// Archetypes, not adjectives. People share an identity, not a number — "El
// Esclavo del Mes" gets screenshotted, "62/100" doesn't.
const ARCHETYPE: Record<string, { en: string; es: string }> = {
  slave: { en: "The Month's Slave", es: "El Esclavo del Mes" },
  juggler: { en: "The Juggler", es: "El Malabarista" },
  builder: { en: "The Silent Builder", es: "El Constructor Silencioso" },
  sower: { en: "The Sower", es: "El Sembrador" },
  braveGiver: { en: "The Brave Giver", es: "El Dador Valiente" },
  steward: { en: "The Faithful Steward", es: "El Mayordomo Fiel" },
  multiplier: { en: "The Steward Who Multiplies", es: "El Mayordomo que Multiplica" },
};

const ARCHETYPE_DESC: Record<string, { en: string; es: string }> = {
  slave: {
    en: "Your month is spoken for before it starts. Not a discipline problem — an arithmetic one.",
    es: "Tu mes ya está vendido antes de empezar. No es un problema de disciplina, es de aritmética.",
  },
  juggler: {
    en: "You reach the end of the month, but with nothing behind you. One slip and it all comes down.",
    es: "Llegas a fin de mes, pero sin nada detrás. Un tropiezo y se cae todo.",
  },
  builder: {
    en: "Nobody sees it yet, but you're already building. Your money is safe — now make it work.",
    es: "Nadie lo ve todavía, pero ya estás construyendo. Tu dinero está a salvo — ahora ponlo a trabajar.",
  },
  sower: {
    en: "You don't just keep what's left over, you plant it. Now add the part that isn't for you.",
    es: "No solo guardas lo que sobra, lo siembras. Ahora suma la parte que no es para ti.",
  },
  braveGiver: {
    en: "You give faithfully before securing yourself. Admirable and fragile at once — you need a cushion.",
    es: "Das con fidelidad antes de asegurarte a ti mismo. Admirable y frágil a la vez — te falta un colchón.",
  },
  steward: {
    en: "You give faithfully and still keep margin. You own your money instead of owing it.",
    es: "Das con fidelidad y aun así te queda margen. Tu dinero es tuyo, no de tus deudas.",
  },
  multiplier: {
    en: "You give faithfully and put the rest to work. This is what stewardship looks like compounding.",
    es: "Das con fidelidad y pones el resto a trabajar. Así es la mayordomía cuando se multiplica.",
  },
};

export function archetypeLabel(key: string, lang: Lang): string {
  return ARCHETYPE[key]?.[lang] ?? key;
}
export function archetypeDescription(key: string, lang: Lang): string {
  return ARCHETYPE_DESC[key]?.[lang] ?? "";
}

// One line that explains the archetype back to the person, so the label lands as
// recognition ("that's me") rather than a verdict.
const STAGE_DESC: Record<string, { en: string; es: string }> = {
  building: {
    en: "Your month is spoken for before it starts. Not a discipline problem — an arithmetic one.",
    es: "Tu mes ya está vendido antes de empezar. No es un problema de disciplina, es de aritmética.",
  },
  balancing: {
    en: "You keep every ball in the air, but one slip and it all comes down. You need slack, not effort.",
    es: "Mantienes todas las bolas en el aire, pero un tropiezo y se cae todo. Te falta margen, no esfuerzo.",
  },
  growing: {
    en: "Nobody sees it yet, but you're already building. Keep going — this compounds.",
    es: "Nadie lo ve todavía, pero ya estás construyendo. Sigue — esto se acumula.",
  },
  solid: {
    en: "You own your money instead of owing it. Now it's about purpose, not survival.",
    es: "Tu dinero es tuyo, no de tus deudas. Ahora la pregunta es el propósito, no la supervivencia.",
  },
};

// Traffic light for the shareable card: at a glance, am I OK or not?
export type StageLight = "red" | "amber" | "green";
const STAGE_LIGHT: Record<string, StageLight> = {
  building: "red",
  balancing: "amber",
  growing: "green",
  solid: "green",
};

export function stageDescription(key: string, lang: Lang): string {
  return STAGE_DESC[key]?.[lang] ?? "";
}
export function stageLight(key: string): StageLight {
  return STAGE_LIGHT[key] ?? "amber";
}

// The Radiografía's own 5-stage engine (server/lib/radiografia/stage/engine.ts:
// cimientos → liberacion → terreno_firme → fortaleza → multiplicacion), NOT the
// STAGE dict above — that one is the unrelated xray health-index 4-band score
// (building/balancing/growing/solid). Mirrors radiografia.methodStage.* in
// src/locales, word for word — that JSON is the reviewed Spanish source of
// truth for launch copy, so this must never drift from it independently.
const RADIOGRAFIA_STAGE: Record<string, { en: string; es: string }> = {
  cimientos: { en: "Foundations", es: "Cimientos" },
  cerrando_la_brecha: { en: "Foundations", es: "Cimientos" },
  liberacion: { en: "Liberation", es: "Liberación" },
  terreno_firme: { en: "Solid Ground", es: "Terreno Firme" },
  fortaleza: { en: "Stronghold", es: "Fortaleza" },
  multiplicacion: { en: "Multiplication", es: "Multiplicación" },
};

const RADIOGRAFIA_STAGE_DESC: Record<string, { en: string; es: string }> = {
  cimientos: {
    en: "You're building your cushion — the first step before anything else.",
    es: "Estás construyendo tu colchón — el primer paso antes de cualquier otra cosa.",
  },
  cerrando_la_brecha: {
    en: "Right now your expenses exceed your income. The first goal is closing that gap.",
    es: "Ahora mismo tus gastos superan tus ingresos. El primer objetivo es cerrar esa brecha.",
  },
  liberacion: {
    en: "You already have your cushion. Now it's time to free yourself from debt.",
    es: "Ya tienes tu colchón. Ahora toca liberarte de tus deudas.",
  },
  terreno_firme: {
    en: "You're debt-free. Time to build your emergency fund.",
    es: "Estás libre de deudas. Es momento de construir tu fondo de emergencia.",
  },
  fortaleza: {
    en: "Debt-free with a full emergency fund. Your base is solid.",
    es: "Libre de deudas y con tu fondo de emergencia completo. Tu base es sólida.",
  },
  multiplicacion: {
    en: "Debt-free, with an emergency fund, and investing. You're growing what you have.",
    es: "Libre de deudas, con fondo de emergencia, e invirtiendo. Estás haciendo crecer lo que tienes.",
  },
};

// `key` should be `branchId ?? stageId` — a branch (e.g. cerrando_la_brecha) is
// a more specific message than its parent stage, same precedence the frontend
// already uses in ResultPlaceholder.tsx.
export function radiografiaStageLabel(key: string, lang: Lang): string {
  return RADIOGRAFIA_STAGE[key]?.[lang] ?? key;
}
export function radiografiaStageDescription(key: string, lang: Lang): string {
  return RADIOGRAFIA_STAGE_DESC[key]?.[lang] ?? "";
}

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
