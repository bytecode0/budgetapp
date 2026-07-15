// Built-in category taxonomy for the Radiografía Financiera.
//
// The anonymous flow has no user categories to classify against, and AI may be
// disabled. This keyword map gives a solid rule-based default so the "where your
// money goes" section always works. AI grouping (suggestCategories) can enrich
// or override this later. Returns a stable `key` — the frontend maps it to an
// i18n label + colour, so no user-facing Spanish/English is hard-coded here.

export interface CategoryDef {
  key: string;
  icon: string;
  // Substrings matched against the normalized merchant (accent/lowercase-stripped).
  keywords: string[];
}

export const CATEGORIES: CategoryDef[] = [
  { key: "supermarket", icon: "🛒", keywords: ["mercadona", "carrefour", "lidl", "dia", "aldi", "eroski", "alcampo", "consum", "supercor", "ahorramas", "hipercor", "supermercado"] },
  { key: "delivery", icon: "🛵", keywords: ["glovo", "ubereats", "uber eats", "just eat", "justeat", "deliveroo"] },
  { key: "restaurants", icon: "🍽️", keywords: ["restaurante", "cafeteria", "cafe", "bar ", "mcdonald", "burger", "kfc", "telepizza", "dominos", "goiko", "vips", "starbucks", "taberna", "pizzeria"] },
  { key: "transport", icon: "🚕", keywords: ["uber", "cabify", "taxi", "renfe", "metro", "emt", "bus", "bicimad", "blablacar", "cercanias"] },
  { key: "fuel", icon: "⛽", keywords: ["repsol", "cepsa", "galp", "shell", "bp ", "gasolinera", "petronor", "carburante"] },
  { key: "subscriptions", icon: "📺", keywords: ["netflix", "spotify", "hbo", "disney", "prime video", "youtube", "icloud", "dazn", "filmin", "audible", "patreon", "twitch"] },
  { key: "utilities", icon: "💡", keywords: ["iberdrola", "endesa", "naturgy", "movistar", "vodafone", "orange", "yoigo", "masmovil", "factura", "electrica"] },
  { key: "shopping", icon: "🛍️", keywords: ["amazon", "aliexpress", "zara", "primark", "corte ingles", "mediamarkt", "decathlon", "ikea", "pccomponentes", "shein"] },
  { key: "health", icon: "💊", keywords: ["farmacia", "clinica", "dentista", "hospital", "sanitas", "adeslas", "dkv", "optica"] },
  { key: "fitness", icon: "🏋️", keywords: ["gimnasio", "basicfit", "mcfit", "altafit", "vivagym", "fitness", "crossfit"] },
  { key: "insurance", icon: "🛡️", keywords: ["seguro", "mapfre", "mutua", "axa", "allianz", "linea directa", "catalana", "reale"] },
  { key: "housing", icon: "🏠", keywords: ["alquiler", "hipoteca", "comunidad", "inmobiliaria", "prestamo"] },
  { key: "education", icon: "📚", keywords: ["udemy", "coursera", "colegio", "universidad", "academia", "matricula", "domestika"] },
  { key: "travel", icon: "✈️", keywords: ["booking", "airbnb", "ryanair", "vueling", "iberia", "hotel", "hostel", "edreams"] },
  { key: "cash", icon: "💶", keywords: ["cajero", "retirada", "reintegro", "atm", "efectivo"] },
];

const OTHER: CategoryDef = { key: "other", icon: "💰", keywords: [] };

/** Classify a normalized merchant into a category key. Falls back to "other". */
export function classifyLocal(merchant: string): CategoryDef {
  const m = ` ${merchant} `;
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(k => m.includes(k))) return cat;
  }
  return OTHER;
}

export function iconForKey(key: string): string {
  return CATEGORIES.find(c => c.key === key)?.icon ?? OTHER.icon;
}
