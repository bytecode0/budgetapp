import { button, callout, heading, paragraph, type RenderedEmail } from "../components.js";
import { formatDate } from "../format.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { appLink, firstName, named, renderEmail, strings } from "./shared.js";

export interface AccountDeletionRequestedData {
  name: string;
  /** The earliest moment the daily job may delete the account (request + 24 h). */
  deleteAfter: Date;
}

/** Sent when a deletion request is confirmed (server/lib/accountDeletion.ts).
 *  The link only opens the app: cancelling happens signed in, in Settings. */
export function accountDeletionRequestedEmail(data: AccountDeletionRequestedData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.accountDeletionRequested;
  const name = firstName(data.name);
  const date = formatDate(data.deleteAfter, locale);
  const email = renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader),
    accent: "warning",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      callout("warning", t(s.when, { date }), t(s.whenTitle)),
      paragraph(t(s.cancelHow)),
      button(t(s.cta), appLink("/?open=settings")),
      callout("info", t(s.notYouBody), t(s.notYouTitle)),
    ],
  });
  return { ...email, replyTo: getTheme().supportEmail };
}
