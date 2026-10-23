// Shared HTTP plumbing for API-based transports: one timeout and one set of
// error conventions for every provider.

export const SEND_TIMEOUT_MS = 10_000;

const EMAIL_ADDRESS = /[^\s<>()[\]"',;:]+@[^\s<>()[\]"',;:]+/g;

/** Providers sometimes echo addresses in their error text; errors end up in logs, so strip them. */
export function redactAddresses(text: string): string {
  return text.replace(EMAIL_ADDRESS, "[address]");
}

export interface JsonResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  payload: unknown,
): Promise<JsonResponse> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`[email] ${provider} did not respond within ${SEND_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`[email] ${provider} returned HTTP ${res.status} with a non-JSON body`);
  }
  return { status: res.status, ok: res.ok, body };
}
