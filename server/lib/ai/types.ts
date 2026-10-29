// Transport-layer types for AI completions. Transports know nothing about
// features (import mapping, classification…): they get a fully built request
// and a resolved config, and return the model's text or throw.

/** What a feature asks for. */
export interface CompletionRequest {
  /** Instructions for the model. */
  system: string;
  /** The user turn. Callers put only data they are allowed to send. */
  prompt: string;
  /** Ask for a JSON object (OpenAI-style response_format where supported). */
  json?: boolean;
  maxTokens: number;
  /** Per-call limit; the module caps it at AI_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Resolved from the environment at call time by index.ts. */
export interface TransportConfig {
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export interface AiTransport {
  /** The AI_PROVIDER value that selects this transport. */
  name: string;
  /** The env var holding its API key. */
  keyEnv: string;
  /** Returns the model's text, or throws. Errors never contain the API key. */
  complete(req: CompletionRequest, cfg: TransportConfig): Promise<string>;
}
