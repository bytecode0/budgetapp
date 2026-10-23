// Provider-agnostic email sending. Config is read on every send, not at import:
// the modules that send email are loaded by the whole app at startup, and a
// missing variable must break sending email, not every route.
//
// Swap provider: change EMAIL_PROVIDER (and that provider's key).
// Add a provider: one file in transports/ implementing EmailTransport, plus one
// line in TRANSPORTS below.
import { consoleTransport } from "./transports/console.js";
import { cloudflareTransport } from "./transports/cloudflare.js";
import { resendTransport } from "./transports/resend.js";
import { parseSender, requireEnv } from "./sender.js";
import type { EmailMessage, EmailTransport } from "./types.js";

export type { EmailMessage, EmailTransport, Sender } from "./types.js";

const TRANSPORTS: Record<string, EmailTransport> = {
  [resendTransport.name]: resendTransport,
  [cloudflareTransport.name]: cloudflareTransport,
  [consoleTransport.name]: consoleTransport,
};

const KNOWN = Object.keys(TRANSPORTS).join(" | ");

function selectTransport(): EmailTransport {
  const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (!provider) {
    throw new Error(`[email] EMAIL_PROVIDER is not set (expected ${KNOWN}); cannot send email`);
  }
  // The unknown value is not echoed: a misplaced secret must not reach the logs.
  if (!Object.hasOwn(TRANSPORTS, provider)) {
    throw new Error(`[email] EMAIL_PROVIDER is not a known provider (expected ${KNOWN}); cannot send email`);
  }
  return TRANSPORTS[provider];
}

/** Sends one rendered message through the configured provider. Rejects on any failure. */
export async function sendEmail(msg: EmailMessage): Promise<{ id?: string }> {
  const transport = selectTransport();
  const from = parseSender(requireEnv("EMAIL_FROM"));
  return transport.send(msg, from);
}
