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

interface CloudflareSendResponse {
  success: boolean;
  errors?: { code: number; message: string }[];
  result?: {
    delivered?: string[];
    permanent_bounces?: string[];
    queued?: string[];
  } | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[email] ${name} is not set; cannot send email`);
  return value;
}

export async function sendEmail({ to, subject, html, text }: EmailMessage): Promise<void> {
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = requireEnv("CLOUDFLARE_EMAIL_API_TOKEN");
  const from = requireEnv("EMAIL_FROM");

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, text }),
    },
  );

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

  const bounces = body.result?.permanent_bounces ?? [];
  if (bounces.length > 0) {
    throw new Error(`[email] permanent bounce for ${bounces.join(", ")}`);
  }
}
