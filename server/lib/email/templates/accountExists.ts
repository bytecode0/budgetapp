import { button, callout, heading, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { appLink, firstName, named, renderEmail, strings } from "./shared.js";

export interface AccountExistsData {
  /** The name on the existing account (never the one typed at the sign-up). */
  name: string;
}

/**
 * Sent instead of a code when someone signs up with an email that already has
 * a verified account (LPBETA-23 item 5): the sign-up answers the same either
 * way, so only the owner of the inbox learns the account exists.
 */
export function accountExistsEmail(data: AccountExistsData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.accountExists;
  const name = firstName(data.name);
  return renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader),
    accent: "brand",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      button(t(s.cta), appLink()),
      paragraph(t(s.forgot), { muted: true }),
      callout("info", t(s.notYouBody), t(s.notYouTitle)),
    ],
  });
}
