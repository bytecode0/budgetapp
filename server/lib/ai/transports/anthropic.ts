// Anthropic Messages API through the official SDK (the one the expense
// classification uses, server/lib/ai/client.ts). Select with
// AI_PROVIDER=anthropic; key in ANTHROPIC_API_KEY. A client per call: config
// is read at call time, and the SDK is given the global fetch then (so a
// stubbed fetch in tests is the one used).
import Anthropic from "@anthropic-ai/sdk";
import type { AiTransport } from "../types.js";
import { isTimeout, redactSecrets } from "./errors.js";

export const anthropicTransport: AiTransport = {
  name: "anthropic",
  keyEnv: "ANTHROPIC_API_KEY",
  async complete(req, cfg) {
    const client = new Anthropic({
      apiKey: cfg.apiKey,
      timeout: cfg.timeoutMs,
      maxRetries: 0,
      fetch: (input, init) => globalThis.fetch(input, init),
    });
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: cfg.model,
        max_tokens: req.maxTokens,
        temperature: 0,
        system: req.system,
        messages: [{ role: "user", content: req.prompt }],
      });
    } catch (err) {
      if (isTimeout(err) || err instanceof Anthropic.APIConnectionTimeoutError) throw new Error(`[ai] Anthropic did not respond within ${cfg.timeoutMs / 1000}s`);
      const status = err instanceof Anthropic.APIError ? ` (HTTP ${err.status ?? "?"})` : "";
      const detail = err instanceof Error ? redactSecrets(err.message, cfg.apiKey) : "unknown error";
      throw new Error(`[ai] Anthropic rejected the request${status}: ${detail}`);
    }
    const text = res.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    if (!text.trim()) throw new Error("[ai] Anthropic returned no content");
    return text;
  },
};
