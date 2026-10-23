import { button, callout, facts, heading, paragraph, type RenderedEmail } from "../components.js";
import { formatDate, formatMoney } from "../format.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { appLink, firstName, named, renderEmail, strings } from "./shared.js";

export interface SubscriptionActivatedData {
  name: string;
  renewalDate: Date;
}

export function subscriptionActivatedEmail(data: SubscriptionActivatedData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.subscriptionActivated;
  const { billing } = getTheme();
  const name = firstName(data.name);
  const amount = t(s.perMonth, { amount: formatMoney(billing.premiumMonthlyCents, billing.currency, locale) });
  return renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader),
    accent: "brand",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      facts([
        { label: t(s.renewalLabel), value: formatDate(data.renewalDate, locale) },
        { label: t(s.amountLabel), value: amount },
      ]),
      paragraph(t(s.thanks)),
      button(t(s.cta), appLink()),
      callout("info", t(s.manage)),
    ],
  });
}
