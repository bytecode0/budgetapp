import { button, callout, eyebrow, facts, heading, paragraph, type Block, type RenderedEmail } from "../components.js";
import { formatMoney, formatMoneyRounded, formatPeriod } from "../format.js";
import type { EmailLocale } from "../locales/index.js";
import { appLink, firstName, renderEmail, strings } from "./shared.js";

export interface MonthlySummaryData {
  name: string;
  /** The budget period summed up, "YYYY-MM". */
  period: string;
  currency: string;
  /** All money in integer cents. */
  subscriptionsCount: number;
  subscriptionsMonthly: number;
  subscriptionsYearly: number;
  /** How many small frequent expenses (merchants or categories). */
  smallCount: number;
  smallTotal: number;
  smallYearly: number;
  halfYearly: number;
  priceRises: number;
  paidYourself: number;
  payYourselfGoal: number | null;
  unsubscribeUrl: string;
}

/** "Tu mes en Remanso" (LPBETA-12), once a month (server/lib/monthlyEmail.ts).
 *  Totals and counts only: no merchant or movement is named in an email. */
export function monthlySummaryEmail(data: MonthlySummaryData, locale: EmailLocale): RenderedEmail {
  const { d, t } = strings(locale);
  const s = d.monthlySummary;
  const month = formatPeriod(data.period, locale);
  const name = firstName(data.name);
  const money = (cents: number) => formatMoney(cents, data.currency, locale);
  const approx = (cents: number) => t(s.approx, { amount: formatMoneyRounded(cents, data.currency, locale) });
  const count = (n: number, one: string, other: string) => t(n === 1 ? one : other, { count: String(n) });

  const blocks: Block[] = [
    eyebrow(month),
    heading(t(s.heading)),
    paragraph(name ? t(s.introNamed, { name, month }) : t(s.intro, { month }), { muted: true }),
    facts([
      { label: t(s.paidLabel), value: money(data.paidYourself) },
      ...(data.payYourselfGoal !== null ? [{ label: t(s.goalLabel), value: money(data.payYourselfGoal) }] : []),
    ]),
  ];
  if (data.subscriptionsCount > 0) {
    blocks.push(facts([
      { label: count(data.subscriptionsCount, s.subscriptionsOne, s.subscriptionsOther), value: t(s.perMonth, { amount: money(data.subscriptionsMonthly) }) },
      { label: t(s.perYearLabel), value: approx(data.subscriptionsYearly) },
    ]));
  } else {
    blocks.push(paragraph(t(s.noSubscriptions)));
  }
  if (data.priceRises > 0) blocks.push(callout("warning", count(data.priceRises, s.priceRisesOne, s.priceRisesOther)));
  blocks.push(paragraph(data.smallCount > 0
    ? t(s.small, { total: money(data.smallTotal), yearly: approx(data.smallYearly) })
    : t(s.noSmall)));
  if (data.halfYearly > 0) blocks.push(callout("success", t(s.half, { amount: approx(data.halfYearly) })));
  blocks.push(
    button(t(s.cta), appLink("/?open=hormiga")),
    paragraph(t(s.privacy), { muted: true, small: true }),
  );

  return renderEmail(locale, {
    subject: t(s.subject, { month }),
    preheader: t(s.preheader),
    accent: "brand",
    blocks,
    unsubscribe: { label: t(s.unsubscribe), url: data.unsubscribeUrl },
  });
}
