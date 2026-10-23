import { callout, divider, eyebrow, heading, otpBox, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { renderEmail, strings } from "./shared.js";

export interface PasswordResetData {
  otp: string;
}

export function passwordResetEmail(data: PasswordResetData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.passwordReset;
  return renderEmail(locale, {
    subject: t(s.subject, { otp: data.otp }),
    preheader: t(s.preheader),
    accent: "warning",
    blocks: [
      eyebrow(t(s.eyebrow)),
      heading(t(s.heading)),
      paragraph(t(s.intro), { muted: true }),
      otpBox(t(s.codeLabel), data.otp, t(s.expires)),
      divider(),
      callout("warning", t(s.notYouBody), t(s.notYouTitle)),
    ],
  });
}
