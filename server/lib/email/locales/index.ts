import { en } from "./en.js";
import { es, type EmailDictionary } from "./es.js";

export type EmailLocale = "es" | "en";
export type { EmailDictionary };

export const DICTIONARIES: Record<EmailLocale, EmailDictionary> = { es, en };

/** Maps UserSettings.language (or nothing) to an email locale. Spanish is the default. */
export function resolveLocale(language: string | null | undefined): EmailLocale {
  return language?.toLowerCase().startsWith("en") ? "en" : "es";
}

/** Fills {placeholders}. Unknown placeholders are left as is so a typo shows in the preview. */
export function fill(template: string, vars: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(vars, key) ? vars[key] : match,
  );
}
