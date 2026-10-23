// Local development only: prints the message instead of sending it, so OTPs and
// links can be read from the server log. Selected only by an explicit
// EMAIL_PROVIDER=console, never as a fallback, and refused in production.
import type { EmailTransport } from "../types.js";

export const consoleTransport: EmailTransport = {
  name: "console",
  async send(msg, from) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[email] EMAIL_PROVIDER=console is for local development and is refused when NODE_ENV=production");
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
