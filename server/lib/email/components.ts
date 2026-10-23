// HTML building blocks for emails: table-based, inline-styled markup that holds
// up in Gmail and Outlook. Every block also yields its plain-text counterpart, so
// a template builds html and text from the same content.
//
// Every string passed in is treated as plain text and escaped here; callers never
// pre-escape and never pass markup.
import { getTheme, type EmailTheme } from "./theme.js";

export interface Block {
  html: string;
  text: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Set by templates that ask the reader to reply. */
  replyTo?: string;
}

export type Accent = keyof EmailTheme["accents"];
export type Tone = keyof EmailTheme["tones"];

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url.trim());
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Only absolute http(s) and mailto links are allowed into an href. Throws: use it
 * for links that are the point of the email (accept an invite, open the app).
 */
export function safeUrl(url: string): string {
  if (!isHttpUrl(url) && !/^mailto:[^\s@]+@[^\s@]+$/i.test(url.trim())) {
    throw new Error("[email] refusing a link that is not http(s) or mailto");
  }
  return escapeHtml(url.trim());
}

const reportedConfig = new Set<string>();

/**
 * For decoration driven by config (logo, footer link): a bad value must not stop
 * an OTP from going out, so the element is left out and the problem is logged
 * once per process.
 */
function configUrlOrNull(envName: string, url: string | null): string | null {
  if (!url) return null;
  if (isHttpUrl(url)) return url.trim();
  if (!reportedConfig.has(envName)) {
    reportedConfig.add(envName);
    console.error(`[email] ${envName} is not an absolute http(s) URL; it is left out of emails until fixed`);
  }
  return null;
}

// Each content block is one row of the card's inner table.
const row = (inner: string, padding = "0 40px 20px") =>
  `<tr><td style="padding:${padding};">${inner}</td></tr>`;

export function eyebrow(text: string): Block {
  const t = getTheme();
  return {
    html: row(
      `<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:${t.colors.secondary};">${escapeHtml(text)}</p>`,
      "0 40px 8px",
    ),
    text: "",
  };
}

export function heading(text: string): Block {
  const t = getTheme();
  return {
    html: row(
      `<h1 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:${t.colors.text};">${escapeHtml(text)}</h1>`,
      "0 40px 16px",
    ),
    text: text,
  };
}

export function paragraph(text: string, opts: { muted?: boolean; small?: boolean; center?: boolean } = {}): Block {
  const t = getTheme();
  const color = opts.muted ? t.colors.muted : t.colors.text;
  const size = opts.small ? 12 : 15;
  return {
    html: row(
      `<p style="margin:0;font-size:${size}px;line-height:1.6;color:${color};${opts.center ? "text-align:center;" : ""}">${escapeHtml(text)}</p>`,
    ),
    text,
  };
}

export function button(label: string, href: string): Block {
  const t = getTheme();
  const url = safeUrl(href);
  return {
    html: row(
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
        <tr><td align="center" bgcolor="${t.colors.primary}" style="border-radius:${t.radius.button}px;background:${t.colors.primary};">
          <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${t.fontStack};font-size:15px;font-weight:700;color:${t.colors.onPrimary};text-decoration:none;border-radius:${t.radius.button}px;">${escapeHtml(label)}</a>
        </td></tr>
      </table>`,
      "8px 40px 24px",
    ),
    text: `${label}: ${href}`,
  };
}

export function otpBox(label: string, code: string, note: string): Block {
  const t = getTheme();
  return {
    html: row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td align="center" style="background:${t.tones.info.background};border:2px solid ${t.tones.info.border};border-radius:${t.radius.box}px;padding:24px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${t.colors.muted};">${escapeHtml(label)}</p>
          <p style="margin:0;font-family:${t.monoFontStack};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:12px;color:${t.colors.primary};">${escapeHtml(code)}</p>
          <p style="margin:12px 0 0;font-size:12px;color:${t.colors.subtle};">${escapeHtml(note)}</p>
        </td></tr>
      </table>`,
      "8px 40px 24px",
    ),
    text: `${label}:\n\n    ${code}\n\n${note}`,
  };
}

export function callout(tone: Tone, body: string, title?: string): Block {
  const t = getTheme();
  const c = t.tones[tone];
  const titleHtml = title ? `<strong style="color:${c.text};">${escapeHtml(title)}</strong> ` : "";
  return {
    html: row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td style="background:${c.background};border:1px solid ${c.border};border-radius:${t.radius.box}px;padding:16px 20px;">
          <p style="margin:0;font-size:14px;line-height:1.6;color:${c.text};">${titleHtml}${escapeHtml(body)}</p>
        </td></tr>
      </table>`,
    ),
    text: title ? `${title} ${body}` : body,
  };
}

export interface ListItem {
  title?: string;
  body: string;
}

/** A checklist. An optional title is rendered as a small caption above it. */
export function checklist(items: ListItem[], title?: string): Block {
  const t = getTheme();
  const rows = items
    .map(
      (item) => `<tr>
        <td width="24" valign="top" style="padding:5px 0;font-size:14px;line-height:1.5;color:${t.colors.secondary};">&#10003;</td>
        <td style="padding:5px 0;font-size:14px;line-height:1.5;color:${t.colors.muted};">${
          item.title ? `<strong style="color:${t.colors.text};">${escapeHtml(item.title)}</strong> &mdash; ` : ""
        }${escapeHtml(item.body)}</td>
      </tr>`,
    )
    .join("");
  const caption = title
    ? `<p style="margin:0 0 12px;font-size:12px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${t.colors.muted};">${escapeHtml(title)}</p>`
    : "";
  const textItems = items.map((i) => `- ${i.title ? `${i.title}: ` : ""}${i.body}`).join("\n");
  return {
    html: row(`${caption}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`),
    text: title ? `${title}:\n${textItems}` : textItems,
  };
}

/** Label/value pairs side by side, e.g. renewal date and amount. */
export function facts(pairs: { label: string; value: string }[]): Block {
  const t = getTheme();
  const cells = pairs
    .map(
      (p, i) => `<td valign="top" style="padding:16px 20px;${i > 0 ? "text-align:right;" : ""}">
        <p style="margin:0;font-size:13px;color:${t.colors.muted};">${escapeHtml(p.label)}</p>
        <p style="margin:4px 0 0;font-size:17px;font-weight:700;color:${t.colors.text};">${escapeHtml(p.value)}</p>
      </td>`,
    )
    .join("");
  return {
    html: row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.colors.pageBackground};border-radius:${t.radius.box}px;"><tr>${cells}</tr></table>`,
    ),
    text: pairs.map((p) => `${p.label}: ${p.value}`).join("\n"),
  };
}

export function divider(): Block {
  const t = getTheme();
  return {
    html: row(`<div style="height:1px;line-height:1px;font-size:1px;background:${t.colors.border};">&nbsp;</div>`, "4px 40px 24px"),
    text: "",
  };
}

export interface LayoutOptions {
  lang: string;
  subject: string;
  /** Inbox preview line; hidden in the body. */
  preheader: string;
  accent: Accent;
  blocks: Block[];
  footer: { tagline: string; reason: string; visitLabel: string; supportLabel: string };
}

/** The shell: preheader, logo header, card with accent bar, footer. */
export function layout(opts: LayoutOptions): RenderedEmail {
  const t = getTheme();
  const product = escapeHtml(t.productName);
  const logoUrl = configUrlOrNull("LOGO_URL", t.logoUrl);
  const appUrl = configUrlOrNull("APP_URL", t.appUrl);
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${product}" width="24" height="24" style="display:block;border:0;border-radius:6px;" />`
    : `<div style="width:24px;height:24px;line-height:24px;border-radius:6px;background:${t.colors.primary};color:${t.colors.onPrimary};text-align:center;font-size:13px;font-weight:700;">${escapeHtml(t.productName.charAt(0))}</div>`;
  // Padding after the preheader stops clients pulling body text into the preview.
  const preheaderPad = "&#847;&zwnj;&nbsp;".repeat(60);

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(opts.lang)}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(opts.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${t.colors.pageBackground};font-family:${t.fontStack};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}${preheaderPad}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${t.colors.pageBackground};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td align="center" style="padding-bottom:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="padding-right:8px;">${logo}</td>
          <td valign="middle" style="font-family:${t.fontStack};font-size:18px;font-weight:700;letter-spacing:-0.3px;color:${t.colors.primary};">${product}</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${t.colors.card};border:1px solid ${t.colors.border};border-radius:${t.radius.card}px;overflow:hidden;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="height:4px;line-height:4px;font-size:4px;background:${t.accents[opts.accent]};border-radius:${t.radius.card}px ${t.radius.card}px 0 0;">&nbsp;</td></tr>
          <tr><td style="height:32px;line-height:32px;font-size:1px;">&nbsp;</td></tr>
          ${opts.blocks.map((b) => b.html).join("\n          ")}
          <tr><td style="height:16px;line-height:16px;font-size:1px;">&nbsp;</td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="padding:24px 16px 0;">
        <p style="margin:0 0 6px;font-size:12px;color:${t.colors.muted};">${escapeHtml(opts.footer.tagline)}</p>
        <p style="margin:0 0 6px;font-size:12px;">
          ${appUrl ? `<a href="${escapeHtml(appUrl)}" style="color:${t.colors.primary};text-decoration:none;">${escapeHtml(opts.footer.visitLabel)}</a>
          <span style="color:${t.colors.subtle};"> &middot; </span>` : ""}
          <a href="${safeUrl(`mailto:${t.supportEmail}`)}" style="color:${t.colors.muted};text-decoration:none;">${escapeHtml(opts.footer.supportLabel)}</a>
        </p>
        <p style="margin:0;font-size:11px;color:${t.colors.subtle};">${escapeHtml(opts.footer.reason)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const body = opts.blocks.map((b) => b.text).filter(Boolean).join("\n\n");
  const footer = [
    "--",
    opts.footer.tagline,
    ...(appUrl ? [`${opts.footer.visitLabel}: ${appUrl}`] : []),
    `${opts.footer.supportLabel}: ${t.supportEmail}`,
    opts.footer.reason,
  ].join("\n");
  const text = `${body}\n\n${footer}\n`;

  return { subject: opts.subject, html, text };
}
