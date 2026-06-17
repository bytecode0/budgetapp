// Shared Anthropic client + config for the AI features (Phase J).
//
// The client is created lazily and only when an API key is configured, so the
// rest of the app runs unchanged when AI is disabled. All callers degrade
// gracefully when getAiClient() returns null.
import Anthropic from "@anthropic-ai/sdk";

export const AI_MODEL = process.env.AI_MODEL ?? "claude-haiku-4-5";
export const AI_TIMEOUT_MS = 20_000;

let client: Anthropic | null = null;

export function getAiClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return (client ??= new Anthropic());
}

/** True when an API key is configured. The frontend gates its AI buttons on this. */
export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
