import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';

// Euros (as the API returns them) → display text, with the currency symbol
// from i18n. Rounding happens only here, at the render layer.
export function useMoney() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const locale = language === 'es' ? 'es-ES' : 'en-GB';
  const currency = t('currency.symbol');
  const fmt = (v: number) =>
    `${currency}${v.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  return { fmt, currency, locale };
}
