// Provider-agnostic AI completions, mirroring the email module: config is read
// on every call, not at import, and transports know nothing about features.
//
//   AI_PROVIDER   openrouter | anthropic | none   (read at call time)
//   <key>         OPENROUTER_API_KEY / ANTHROPIC_API_KEY, per transport
//   AI_MODEL_<FEATURE>   the model each feature uses (FEATURE_MODEL_ENV)
//
// Anything missing (provider, its key, the feature's model) makes the feature
// UNAVAILABLE — never an invented default model or a fallback key. Swap
// provider: change AI_PROVIDER (and that provider's key and the feature's
// model). Add a provider: one file in transports/ implementing AiTransport,
// plus one line in TRANSPORTS.
//
// The expense classification (classify.ts, suggestCategories.ts) still calls
// Anthropic directly through client.ts; it can move here later.
import { anthropicTransport } from "./transports/anthropic.js";
import { openRouterTransport } from "./transports/openrouter.js";
import type { AiTransport, CompletionRequest } from "./types.js";

export type { CompletionRequest } from "./types.js";

/** Hard cap per call: a feature waiting longer is a feature that's down. */
export const AI_TIMEOUT_MS = 10_000;

const TRANSPORTS: Record<string, AiTransport> = {
  [openRouterTransport.name]: openRouterTransport,
  [anthropicTransport.name]: anthropicTransport,
};

/** Each feature names the env var holding its model id. */
export const FEATURE_MODEL_ENV = {
  importMapping: "AI_MODEL_IMPORT_MAPPING",
} as const;
export type AiFeature = keyof typeof FEATURE_MODEL_ENV;

export class AiUnavailableError extends Error {
  constructor(feature: AiFeature) {
    super(`[ai] ${feature} is not configured (AI_PROVIDER, its API key and ${FEATURE_MODEL_ENV[feature]} are all required)`);
    this.name = "AiUnavailableError";
  }
}

const env = (name: string) => process.env[name]?.trim() || null;

function resolve(feature: AiFeature): { transport: AiTransport; apiKey: string; model: string } | null {
  const provider = env("AI_PROVIDER")?.toLowerCase();
  // "none", unset or unknown (the value isn't echoed: a misplaced secret must
  // not reach the logs) → unavailable.
  if (!provider || !Object.hasOwn(TRANSPORTS, provider)) return null;
  const transport = TRANSPORTS[provider];
  const apiKey = env(transport.keyEnv);
  const model = env(FEATURE_MODEL_ENV[feature]);
  if (!apiKey || !model) return null;
  return { transport, apiKey, model };
}

/** Whether the feature can call a model right now (for the UI to offer it). */
export function aiAvailable(feature: AiFeature): boolean {
  return resolve(feature) !== null;
}

/** One completion for a feature: the model's text. Throws AiUnavailableError
 *  when the feature isn't configured, Error on any provider failure. */
export async function complete(feature: AiFeature, req: CompletionRequest): Promise<string> {
  const cfg = resolve(feature);
  if (!cfg) throw new AiUnavailableError(feature);
  const timeoutMs = Math.min(req.timeoutMs ?? AI_TIMEOUT_MS, AI_TIMEOUT_MS);
  return cfg.transport.complete(req, { model: cfg.model, apiKey: cfg.apiKey, timeoutMs });
}
