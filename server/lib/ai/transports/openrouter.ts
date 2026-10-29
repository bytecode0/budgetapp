// OpenRouter (https://openrouter.ai/docs): an OpenAI-compatible chat
// completions API in front of many models. Select with AI_PROVIDER=openrouter;
// key in OPENROUTER_API_KEY. Called with fetch, no SDK.
import type { AiTransport } from "../types.js";
import { isTimeout, redactSecrets } from "./errors.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// Sent as X-Title: how the app shows up in OpenRouter's dashboards. Not user-facing.
const APP_TITLE = "LifePlan";

/** APP_URL as the optional HTTP-Referer, only when it's a valid http(s) URL. */
function referer(): string | null {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

interface OpenRouterResponse {
  choices?: { message?: { content?: string | null } }[];
  error?: { message?: string; code?: number | string };
}

export const openRouterTransport: AiTransport = {
  name: "openrouter",
  keyEnv: "OPENROUTER_API_KEY",
  async complete(req, cfg) {
    const ref = referer();
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": APP_TITLE,
          ...(ref ? { "HTTP-Referer": ref } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
          max_tokens: req.maxTokens,
          temperature: 0,
          ...(req.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw new Error(`[ai] OpenRouter did not respond within ${cfg.timeoutMs / 1000}s`);
      throw new Error("[ai] OpenRouter could not be reached");
    }

    let body: OpenRouterResponse;
    try {
      body = (await res.json()) as OpenRouterResponse;
    } catch {
      throw new Error(`[ai] OpenRouter returned HTTP ${res.status} with a non-JSON body`);
    }
    if (!res.ok || body.error) {
      const detail = body.error?.message ? redactSecrets(body.error.message, cfg.apiKey) : "no error details";
      throw new Error(`[ai] OpenRouter rejected the request (HTTP ${res.status}): ${detail}`);
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("[ai] OpenRouter returned no content");
    return content;
  },
};
