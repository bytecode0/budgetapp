// The merchants a client sends to the AI import endpoints (classify,
// suggest-categories), bounded before they become tokens (LPBETA-17): at most
// MAX_MERCHANTS distinct names, each cut to MAX_MERCHANT_CHARS. The AI answers
// with the cut names; `originals` maps each one back to what the client sent,
// so its suggestions still match the rows on screen.

export const MAX_MERCHANTS = 40;
export const MAX_MERCHANT_CHARS = 100;

export interface MerchantInput {
  /** What goes to the AI: distinct, non-empty, each at most MAX_MERCHANT_CHARS. */
  merchants: string[];
  /** Cut name → the names the client sent that it stands for. */
  originals: Map<string, string[]>;
}

export function parseMerchantInput(raw: unknown): MerchantInput {
  const originals = new Map<string, string[]>();
  if (!Array.isArray(raw)) return { merchants: [], originals };
  for (const m of new Set(raw)) {
    if (typeof m !== "string" || m.length === 0) continue;
    // Array.from splits by code point, so an emoji isn't cut in half.
    const cut = Array.from(m).slice(0, MAX_MERCHANT_CHARS).join("");
    const same = originals.get(cut);
    if (same) same.push(m);
    else if (originals.size < MAX_MERCHANTS) originals.set(cut, [m]);
  }
  return { merchants: [...originals.keys()], originals };
}

/** The names the client sent for the cut names the AI returned. */
export function toOriginals(input: MerchantInput, merchants: string[]): string[] {
  return merchants.flatMap(m => input.originals.get(m) ?? []);
}
