// Shared error conventions for AI transports: one timeout message, and no
// secret ever reaches an error (errors end up in logs).

/** Removes the key itself and anything shaped like a provider key. */
export function redactSecrets(text: string, apiKey: string): string {
  let out = apiKey ? text.split(apiKey).join("[key]") : text;
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|sk_[A-Za-z0-9_-]{8,})/g, "[key]");
  return out.slice(0, 300);
}

export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}
