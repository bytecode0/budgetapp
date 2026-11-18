// Locale-aware formatting for values shown in emails. Money arrives as integer
// cents and is converted only here, at render.
import type { EmailLocale } from "./locales/index.js";

const INTL_LOCALE: Record<EmailLocale, string> = { es: "es-ES", en: "en-GB" };

export function formatMoney(cents: number, currency: string, locale: EmailLocale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency }).format(cents / 100);
}

export function formatDate(date: Date, locale: EmailLocale): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** An approximate figure ("~690 €"): money with no decimals. */
export function formatMoneyRounded(cents: number, currency: string, locale: EmailLocale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "currency", currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(cents / 100);
}

/** A "YYYY-MM" period label as its month and year ("noviembre de 2026"). */
export function formatPeriod(period: string, locale: EmailLocale): string {
  const [y, m] = period.split("-").map(Number);
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
