import { heading, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";
import { firstName, named, renderEmail, strings } from "./shared.js";

export interface AccountDeletedData {
  name: string;
}

/** Sent by the daily job once the account is gone (server/lib/accountDeletion.ts). */
export function accountDeletedEmail(data: AccountDeletedData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.accountDeleted;
  const name = firstName(data.name);
  const email = renderEmail(locale, {
    subject: t(s.subject),
    preheader: t(s.preheader),
    accent: "neutral",
    blocks: [
      heading(t(s.heading)),
      paragraph(named(t, s.introNamed, s.intro, name), { muted: true }),
      paragraph(t(s.details)),
      paragraph(t(s.goodbye), { muted: true, small: true }),
    ],
  });
  return { ...email, replyTo: getTheme().supportEmail };
}
