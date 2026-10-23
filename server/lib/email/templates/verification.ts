import { divider, eyebrow, heading, otpBox, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { firstName, named, renderEmail, strings } from "./shared.js";

export interface VerificationData {
  name: string;
  otp: string;
}

export function verificationEmail(data: VerificationData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.verification;
  const name = firstName(data.name);
  return renderEmail(locale, {
    subject: t(s.subject, { otp: data.otp }),
    preheader: t(s.preheader),
    accent: "brand",
    blocks: [
      eyebrow(t(s.eyebrow)),
      heading(named(t, s.headingNamed, s.heading, name)),
      paragraph(t(s.intro), { muted: true }),
      otpBox(t(s.codeLabel), data.otp, t(s.expires)),
      divider(),
      paragraph(t(s.ignore), { muted: true, small: true }),
    ],
  });
}
