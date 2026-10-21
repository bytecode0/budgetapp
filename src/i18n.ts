import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

const savedLanguage = localStorage.getItem('language') ?? 'es';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      es: { translation: es },
    },
    lng: savedLanguage,
    fallbackLng: 'es',
    interpolation: { escapeValue: false },
  });

/**
 * Keep <html lang> in sync with the language actually being rendered.
 *
 * index.html ships lang="es" for the public Radiografía, but the attribute has
 * to follow i18next afterwards: the Radiografía forces 'es' at runtime while the
 * authenticated BudgetApp can be switched to 'en' (LanguageContext). A stale
 * `lang` is not cosmetic — it tells a screen reader which pronunciation rules to
 * apply, so Spanish read with English rules becomes hard to follow, and it is
 * what search engines trust to classify the page's language.
 */
const syncHtmlLang = (lng: string) => {
  document.documentElement.lang = lng;
};

syncHtmlLang(i18n.language);
i18n.on('languageChanged', syncHtmlLang);

export default i18n;
