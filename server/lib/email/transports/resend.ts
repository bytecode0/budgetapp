// Resend REST API (https://resend.com/docs/api-reference/emails/send-email).
// Select with EMAIL_PROVIDER=resend. Called with fetch; the `resend` SDK is not used.
import { requireEnv } from "../sender.js";
import type { EmailTransport, Sender } from "../types.js";
import { postJson, redactAddresses } from "./http.js";

const RESEND_SEND_URL = "https://api.resend.com/emails";
// Resend rejects requests without a User-Agent (403, error 1010).
const USER_AGENT = "lifeplan-budgetapp";

interface ResendResponse {
  id?: string;
  statusCode?: number;
  name?: string;
  message?: string;
}

const PLAIN_NAME = /^[\p{L}\p{N} .'-]+$/u;

/** Resend takes `from` as "address" or "Name <address>"; names with specials are quoted. */
export function formatResendSender(from: Sender): string {
  if (!from.name) return from.address;
  const name = PLAIN_NAME.test(from.name)
    ? from.name
    : `"${from.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `${name} <${from.address}>`;
}

export const resendTransport: EmailTransport = {
  name: "resend",
  async send(msg, from) {
    const apiKey = requireEnv("RESEND_API_KEY");

    const payload: Record<string, unknown> = {
      from: formatResendSender(from),
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    };
    if (msg.replyTo) payload.reply_to = msg.replyTo;

    const { status, ok, body: raw } = await postJson(
      "Resend",
      RESEND_SEND_URL,
      { Authorization: `Bearer ${apiKey}`, "User-Agent": USER_AGENT },
      payload,
    );
    const body = (raw ?? {}) as ResendResponse;

    if (!ok) {
      const detail = body.name || body.message
        ? [body.name, body.message].filter(Boolean).join(": ")
        : "no error details";
      throw new Error(`[email] Resend rejected the email (HTTP ${status}): ${redactAddresses(detail)}`);
    }
    if (typeof body.id !== "string" || !body.id) {
      throw new Error(`[email] Resend returned HTTP ${status} without an email id`);
    }
    return { id: body.id };
  },
};
