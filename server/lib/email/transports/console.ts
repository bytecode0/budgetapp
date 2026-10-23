// Local development only: prints the message instead of sending it, so OTPs and
// links can be read from the server log. Selected only by an explicit
// EMAIL_PROVIDER=console, never as a fallback.
import type { EmailTransport } from "../types.js";

/**
 * Allow-list, not deny-list: only an exact NODE_ENV of "development" or "test",
 * and never on Vercel (any deployment there sets VERCEL / VERCEL_ENV). An unset,
 * misspelt or padded NODE_ENV is refused.
 */
export function consoleTransportAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = env.NODE_ENV;
  if (nodeEnv !== "development" && nodeEnv !== "test") return false;
  return env.VERCEL === undefined && env.VERCEL_ENV === undefined;
}

export const consoleTransport: EmailTransport = {
  name: "console",
  async send(msg, from) {
    if (!consoleTransportAllowed()) {
      throw new Error(
        "[email] EMAIL_PROVIDER=console is for local development only: it needs NODE_ENV=development or test and no VERCEL/VERCEL_ENV",
      );
    }
    const sender = from.name ? `${from.name} <${from.address}>` : from.address;
    console.log(
      [
        "──── [email:console] not sent ────",
        `From:    ${sender}`,
        `To:      ${msg.to}`,
        ...(msg.replyTo ? [`Reply-To: ${msg.replyTo}`] : []),
        `Subject: ${msg.subject}`,
        `HTML:    ${msg.html.length} chars (npm run email:preview to see it)`,
        "",
        msg.text,
        "──────────────────────────────────",
      ].join("\n"),
    );
    return { id: "console" };
  },
};
