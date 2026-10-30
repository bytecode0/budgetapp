import { button, callout, heading, paragraph, type RenderedEmail } from "../components.js";
import { formatDate } from "../format.js";
import type { EmailLocale } from "../locales/index.js";
import { appLink, firstName, named, renderEmail, strings } from "./shared.js";

export interface BankConsentExpiringData {
  name: string;
  bankName: string;
  expiresAt: Date;
}

/** Sent once per bank consent, about a week before it lapses (server/lib/banking/cron.ts). */
export function bankConsentExpiringEmail(data: BankConsentExpiringData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.bankConsentExpiring;
  const name = firstName(data.name);
  const date = formatDate(data.expiresAt, locale);
  // Every string may name the bank and the date.
  const tv = (str: string, extra: Record<string, string> = {}) => t(str, { bank: data.bankName, date, ...extra });
  return renderEmail(locale, {
    subject: tv(s.subject),
    preheader: tv(s.preheader),
    accent: "neutral",
    blocks: [
      heading(tv(s.heading)),
      paragraph(named(tv, s.introNamed, s.intro, name), { muted: true }),
      callout("warning", tv(s.whatHappens), tv(s.expiresOn)),
      paragraph(tv(s.howTo)),
      button(tv(s.cta), appLink("/?open=accounts")),
      paragraph(tv(s.privacy), { muted: true, small: true }),
    ],
  });
}
