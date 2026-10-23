import { layout, type Accent, type Block, type ListItem, type RenderedEmail } from "../components.js";
import { DICTIONARIES, fill, type EmailDictionary, type EmailLocale } from "../locales/index.js";
import { getTheme } from "../theme.js";

/** The locale's strings plus a formatter that also fills {product} and {supportEmail}. */
export function strings(locale: EmailLocale): { d: EmailDictionary; t: (s: string, vars?: Record<string, string>) => string } {
  const theme = getTheme();
  const base = { product: theme.productName, supportEmail: theme.supportEmail };
  return { d: DICTIONARIES[locale], t: (s, vars = {}) => fill(s, { ...base, ...vars }) };
}

/** First word of a display name; empty when there is none. */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Picks the variant with the name when there is one, so no email reads "Hi , ...". */
export function named(
  t: (s: string, vars?: Record<string, string>) => string,
  withName: string,
  withoutName: string,
  name: string,
): string {
  return name ? t(withName, { name }) : t(withoutName);
}

export function featureItems(locale: EmailLocale): ListItem[] {
  const { d, t } = strings(locale);
  const f = d.common.features;
  return [
    { title: t(f.plansTitle), body: t(f.plansBody) },
    { title: t(f.spendingTitle), body: t(f.spendingBody) },
    { title: t(f.allocateTitle), body: t(f.allocateBody) },
    { title: t(f.insightsTitle), body: t(f.insightsBody) },
  ];
}

export function renderEmail(
  locale: EmailLocale,
  opts: { subject: string; preheader: string; accent: Accent; blocks: Block[] },
): RenderedEmail {
  const { d, t } = strings(locale);
  return layout({
    lang: locale,
    ...opts,
    footer: {
      tagline: t(d.common.tagline),
      reason: t(d.common.footerReason),
      visitLabel: t(d.common.visit),
      supportLabel: t(d.common.support),
    },
  });
}

export const appLink = (path = "") => `${getTheme().appUrl}${path}`;
