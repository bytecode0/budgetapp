// AI-assisted expense classification (Phase J).
//
// Used as a *fallback* only — the rule engine (Phase B) resolves recurring
// merchants for free; the AI is invoked on demand for the merchants no rule
// matched (the cold-start problem). Output is validated against the user's real
// allocation ids, so the model can never invent a category. Any failure (no API
// key, timeout, malformed output) degrades to "unassigned" — the import is never
// blocked.
import { getAiClient, AI_MODEL, AI_TIMEOUT_MS } from "./client.js";

export { aiEnabled } from "./client.js";

export interface AllocationRef {
  id: string;
  name: string;
}

const SUBMIT_TOOL = {
  name: "submit_classifications",
  description: "Return the chosen allocation for each merchant.",
  input_schema: {
    type: "object" as const,
    properties: {
      classifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            merchant: { type: "string" },
            // null when no allocation fits with confidence.
            allocationId: { type: ["string", "null"] },
          },
          required: ["merchant", "allocationId"],
          additionalProperties: false,
        },
      },
    },
    required: ["classifications"],
    additionalProperties: false,
  },
};

/**
 * Map each merchant to an allocationId (validated against `allocations`), or null
 * when nothing fits / on any failure. Pure fallback: callers should only pass
 * merchants that the rules did not already resolve.
 */
export async function classifyMerchants(
  merchants: string[],
  allocations: AllocationRef[],
): Promise<Record<string, string | null>> {
  const empty: Record<string, string | null> = Object.fromEntries(merchants.map(m => [m, null]));
  const c = getAiClient();
  if (!c || merchants.length === 0 || allocations.length === 0) return empty;

  const allowed = new Set(allocations.map(a => a.id));

  try {
    const res = await c.messages.create(
      {
        model: AI_MODEL,
        max_tokens: 2048,
        tools: [SUBMIT_TOOL],
        tool_choice: { type: "tool", name: SUBMIT_TOOL.name },
        system:
          "You categorize Spanish bank-statement merchants into the user's budget categories (allocations). " +
          "For each merchant, choose the single best-fitting allocation id from the provided list. " +
          "If none fits with reasonable confidence, return null. Only use ids from the list — never invent one.",
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              allocations: allocations.map(a => ({ id: a.id, name: a.name })),
              merchants,
            }),
          },
        ],
      },
      { timeout: AI_TIMEOUT_MS },
    );

    const toolUse = res.content.find(b => b.type === "tool_use");
    const items = (toolUse?.type === "tool_use" ? (toolUse.input as any)?.classifications : null) ?? [];

    const out: Record<string, string | null> = { ...empty };
    for (const item of items) {
      const merchant = item?.merchant;
      const allocationId = item?.allocationId;
      if (typeof merchant === "string" && merchant in out) {
        out[merchant] = typeof allocationId === "string" && allowed.has(allocationId) ? allocationId : null;
      }
    }
    return out;
  } catch (err) {
    console.error("[ai/classify]", err);
    return empty; // degrade — never block the import
  }
}
