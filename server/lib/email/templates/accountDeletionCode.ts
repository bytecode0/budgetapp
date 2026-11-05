import { callout, eyebrow, heading, otpBox, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { renderEmail, strings } from "./shared.js";

export interface AccountDeletionCodeData {
  otp: string;
}

/** The code that confirms "delete my account" (POST /api/account/deletion/code). */
export function accountDeletionCodeEmail(data: AccountDeletionCodeData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.accountDeletionCode;
  const email = renderEmail(locale, {
    subject: t(s.subject, { otp: data.otp }),
    preheader: t(s.preheader),
    accent: "warning",
    blocks: [
      eyebrow(t(s.eyebrow)),
      heading(t(s.heading)),
      paragraph(t(s.intro), { muted: true }),
      otpBox(t(s.codeLabel), data.otp, t(s.expires)),
      callout("warning", t(s.notYouBody), t(s.notYouTitle)),
    ],
  });
  // "Write to us" — replies must reach a mailbox someone reads.
  return { ...email, replyTo: getTheme().supportEmail };
}
