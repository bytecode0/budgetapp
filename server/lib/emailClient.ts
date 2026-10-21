// Sends transactional email through Cloudflare Email Sending's REST API.
// Config is read on every send, not at import: the modules that send email are
// loaded by the whole app at startup, and a missing variable must break sending
// email, not every route.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

type Sender = string | { address: string; name: string };

interface CloudflareSendResponse {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: {
    delivered?: string[];
    permanent_bounces?: string[];
    queued?: string[];
    suppressed_recipients?: string[];
  } | null;
}

const SEND_TIMEOUT_MS = 10_000;
const BARE_ADDRESS = /^[^\s<>@]+@[^\s<>@]+$/;
const NAMED_ADDRESS = /^(.*?)\s*<([^\s<>@]+@[^\s<>@]+)>$/;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[email] ${name} is not set; cannot send email`);
  return value;
}

// The REST API takes `from` as a bare address or { address, name }; the
// "Name <addr>" form is only for SMTP headers, so EMAIL_FROM is parsed here.
export function parseSender(raw: string): Sender {
  const value = raw.trim();
  if (BARE_ADDRESS.test(value)) return value;
  const match = NAMED_ADDRESS.exec(value);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1").trim();
    return name ? { address: match[2], name } : match[2];
  }
  throw new Error('[email] EMAIL_FROM must be "address@domain" or "Name <address@domain>"');
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function sendEmail({ to, subject, html, text }: EmailMessage): Promise<void> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_EMAIL_API_TOKEN");
  const from = parseSender(requireEnv("EMAIL_FROM"));

  let res: Response;
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, html, text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`[email] Cloudflare did not respond within ${SEND_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }

  let body: CloudflareSendResponse;
  try {
    body = (await res.json()) as CloudflareSendResponse;
  } catch {
    throw new Error(`[email] Cloudflare returned HTTP ${res.status} with a non-JSON body`);
  }

  if (!res.ok || !body.success) {
    const detail = body.errors?.length
      ? body.errors.map((e) => `${e.code}: ${e.message}`).join("; ")
      : "no error details";
    throw new Error(`[email] Cloudflare rejected the email (HTTP ${res.status}): ${detail}`);
  }

  // Accepted means delivered or queued for this recipient; anything else
  // (permanent bounce, suppression list, missing) is a failed send.
  const result = body.result ?? {};
  const accepted = [...(result.delivered ?? []), ...(result.queued ?? [])];
  if (!accepted.some((addr) => sameAddress(addr, to))) {
    const bounced = result.permanent_bounces?.length ?? 0;
    const suppressed = result.suppressed_recipients?.length ?? 0;
    throw new Error(
      `[email] Cloudflare did not accept the recipient (${bounced} permanent bounce(s), ${suppressed} suppressed)`,
    );
  }
}
