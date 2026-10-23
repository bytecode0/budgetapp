// Cloudflare Email Sending REST API. Kept as an alternative transport; select it
// with EMAIL_PROVIDER=cloudflare. Sending to arbitrary recipients needs the
// Workers Paid plan and a verified sending domain.
import { requireEnv } from "../sender.js";
import type { EmailTransport, Sender } from "../types.js";
import { postJson, redactAddresses } from "./http.js";

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

// The REST API takes `from` as a bare address or { address, name }; the
// "Name <addr>" form is only for SMTP headers.
function formatSender(from: Sender): string | { address: string; name: string } {
  return from.name ? { address: from.address, name: from.name } : from.address;
}

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const cloudflareTransport: EmailTransport = {
  name: "cloudflare",
  async send(msg, from) {
    const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");
    const token = requireEnv("CLOUDFLARE_EMAIL_API_TOKEN");

    const payload: Record<string, unknown> = {
      from: formatSender(from),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    };
    if (msg.replyTo) payload.reply_to = msg.replyTo;

    const { status, ok, body: raw } = await postJson(
      "Cloudflare",
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
      { Authorization: `Bearer ${token}` },
      payload,
    );
    const body = (raw ?? {}) as CloudflareSendResponse;

    if (!ok || !body.success) {
      const detail = body.errors?.length
        ? body.errors.map((e) => `${e.code}: ${e.message}`).join("; ")
        : "no error details";
      throw new Error(`[email] Cloudflare rejected the email (HTTP ${status}): ${redactAddresses(detail)}`);
    }

    // Accepted means delivered or queued for this recipient; anything else
    // (permanent bounce, suppression list, missing) is a failed send.
    const result = body.result ?? {};
    const accepted = [...(result.delivered ?? []), ...(result.queued ?? [])];
    if (!accepted.some((addr) => sameAddress(addr, msg.to))) {
      const bounced = result.permanent_bounces?.length ?? 0;
      const suppressed = result.suppressed_recipients?.length ?? 0;
      throw new Error(
        `[email] Cloudflare did not accept the recipient (${bounced} permanent bounce(s), ${suppressed} suppressed)`,
      );
    }
    return {};
  },
};
