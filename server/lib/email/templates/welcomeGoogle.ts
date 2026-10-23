import { button, checklist, divider, heading, paragraph, type RenderedEmail } from "../components.js";
import type { EmailLocale } from "../locales/index.js";
import { appLink, featureItems, firstName, named, renderEmail, strings } from "./shared.js";

export interface WelcomeGoogleData {
  name: string;
}

/** Sent on the first Google sign-in (the address is already verified). */
export function welcomeGoogleEmail(data: WelcomeGoogleData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.welcomeGoogle;
  const name = firstName(data.name);
  return renderEmail(locale, {
    subject: named(t, s.subjectNamed, s.subject, name),
    preheader: t(s.preheader),
    accent: "brand",
    blocks: [
      heading(named(t, s.headingNamed, s.heading, name)),
      paragraph(t(s.intro), { muted: true }),
      divider(),
      checklist(featureItems(locale), t(s.featuresTitle)),
      divider(),
      button(t(s.cta), appLink()),
      paragraph(t(s.note), { muted: true, small: true, center: true }),
    ],
  });
}
