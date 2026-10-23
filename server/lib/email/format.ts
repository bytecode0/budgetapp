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
