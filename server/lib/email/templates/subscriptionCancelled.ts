import { button, callout, heading, paragraph, type RenderedEmail } from "../components.js";
import { formatDate } from "../format.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { appLink, firstName, named, renderEmail, strings } from "./shared.js";

export interface SubscriptionCancelledData {
  name: string;
  accessUntilDate: Date;
}

export function subscriptionCancelledEmail(data: SubscriptionCancelledData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.subscriptionCancelled;
  const name = firstName(data.name);
  const date = formatDate(data.accessUntilDate, locale);
  // The email invites a reply, so replies go to a mailbox someone reads.
  const replyTo = getTheme().supportEmail;
  const email = renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader, { date }),
    accent: "neutral",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      callout("warning", t(s.noCharges), t(s.accessUntil, { date })),
      paragraph(t(s.afterDate, { date })),
      paragraph(t(s.reactivatePrompt, { date })),
      button(t(s.cta), appLink("/settings")),
      paragraph(t(s.feedback), { muted: true, small: true }),
    ],
  });
  return { ...email, replyTo };
}
