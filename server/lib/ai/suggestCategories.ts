// AI category proposals (Phase J, Sub-task 4).
//
// For the cold-start case where the user has barely any categories: given the
// merchants from a statement, the AI proposes a concise set of budget categories
// (name + emoji + the merchants each covers). It only PROPOSES — the user
// reviews and confirms before any allocation is created. Degrades to [] on any
// failure.
import { getAiClient, AI_MODEL, AI_TIMEOUT_MS } from "./client.js";

export interface SuggestedCategory {
  name: string;
  icon: string;
  merchants: string[];
}

const MAX_CATEGORIES = 12;

const SUBMIT_TOOL = {
  name: "submit_categories",
  description: "Propose a concise set of personal-budget categories for these merchants.",
  input_schema: {
    type: "object" as const,
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            icon: { type: "string" }, // a single emoji
            merchants: { type: "array", items: { type: "string" } },
          },
          required: ["name", "icon", "merchants"],
          additionalProperties: false,
        },
      },
    },
    required: ["categories"],
    additionalProperties: false,
  },
};

export async function suggestCategories(merchants: string[]): Promise<SuggestedCategory[]> {
  const c = getAiClient();
  if (!c || merchants.length === 0) return [];

  try {
    const res = await c.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 2048,
        tools: [SUBMIT_TOOL],
        tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
        system:
          `Propose a concise set of personal-budget categories (max ${MAX_CATEGORIES}) that cover the given bank-statement merchants. ` +
          "Group similar merchants under one category (e.g. Mercadona/Carrefour → Supermercado; Repsol/Cepsa → Combustible). " +
          "Each category needs a short name, a single emoji icon, and the list of merchants it covers. " +
          "Name the categories in the same language as the merchants.",
        messages: [{ role: "user", content: JSON.stringify({ merchants }) }],
      },
      { timeout: AI_TIMEOUT_MS },
    );

    const toolUse = res.content.find(b => b.type === "tool_use");
    const items = (toolUse?.type === "tool_use" ? (toolUse.input as any)?.categories : null) ?? [];

    const known = new Set(merchants);
    const out: SuggestedCategory[] = [];
    for (const it of items) {
      const name = typeof it?.name === "string" ? it.name.trim().slice(0, 40) : "";
      if (!name) continue;
      const icon = typeof it?.icon === "string" && it.icon.trim() ? it.icon.trim().slice(0, 4) : "💰";
      const ms = Array.isArray(it?.merchants)
        ? it.merchants.filter((m: unknown): m is string => typeof m === "string" && known.has(m))
        : [];
      out.push({ name, icon, merchants: ms });
      if (out.length >= MAX_CATEGORIES) break;
    }
    return out;
  } catch (err) {
    console.error("[ai/suggestCategories]", err);
    return [];
  }
}
