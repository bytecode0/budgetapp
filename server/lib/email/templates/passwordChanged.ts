import { callout, heading, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { firstName, named, renderEmail, strings } from "./shared.js";

export interface PasswordChangedData {
  name: string;
}

export function passwordChangedEmail(data: PasswordChangedData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.passwordChanged;
  const name = firstName(data.name);
  // "Wasn't you? Reply" — replies must reach a mailbox someone reads.
  const replyTo = getTheme().supportEmail;
  const email = renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader),
    accent: "warning",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      callout("warning", t(s.notYouBody), t(s.notYouTitle)),
    ],
  });
  return { ...email, replyTo };
}
