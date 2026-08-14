// Currency / number formatting for the Radiografía, locale-aware.

export function money(amount: number, lang: string, opts?: { decimals?: boolean }): string {
  const locale = lang === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: opts?.decimals ? 2 : 0,
    maximumFractionDigits: opts?.decimals ? 2 : 0,
  }).format(amount);
}

export function pct(fraction: number, lang: string): string {
  const locale = lang === 'es' ? 'es-ES' : 'en-GB';
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(fraction);
}

// Title-cases a normalized merchant key ("netflix com" → "Netflix Com") for display.
export function prettyMerchant(m: string): string {
  return m.replace(/\b\w/g, c => c.toUpperCase());
}
