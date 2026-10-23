import { button, checklist, divider, heading, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { renderEmail, strings } from "./shared.js";

export interface PartnerInviteData {
  /** The inviter's display name; empty falls back to a localised "Your partner". */
  senderName: string;
  acceptUrl: string;
}

export function partnerInviteEmail(data: PartnerInviteData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.partnerInvite;
  const sender = data.senderName.trim() || t(s.fallbackSender);
  return renderEmail(locale, {
    subject: t(s.subject, { sender }),
    preheader: t(s.preheader),
    accent: "brand",
    blocks: [
      heading(t(s.heading)),
      paragraph(t(s.intro, { sender }), { muted: true }),
      divider(),
      checklist(
        [
          { title: t(s.sameDataTitle), body: t(s.sameDataBody) },
          { title: t(s.ownDataTitle), body: t(s.ownDataBody, { sender }) },
          { title: t(s.unlinkTitle), body: t(s.unlinkBody) },
        ],
        t(s.whatTitle),
      ),
      divider(),
      button(t(s.cta), data.acceptUrl),
      paragraph(t(s.expiry), { muted: true, small: true, center: true }),
      paragraph(t(s.ignore, { sender }), { muted: true, small: true, center: true }),
    ],
  });
}
