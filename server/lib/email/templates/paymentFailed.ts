import { button, callout, heading, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { appLink, firstName, named, renderEmail, strings } from "./shared.js";

export interface PaymentFailedData {
  name: string;
}

export function paymentFailedEmail(data: PaymentFailedData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.paymentFailed;
  const name = firstName(data.name);
  // The email invites a reply, so replies go to a mailbox someone reads.
  const replyTo = getTheme().supportEmail;
  const email = renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader),
    accent: "danger",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      callout("danger", t(s.warning)),
      paragraph(t(s.update)),
      button(t(s.cta), appLink("/settings")),
      paragraph(t(s.help), { muted: true, small: true }),
    ],
  });
  return { ...email, replyTo };
}
