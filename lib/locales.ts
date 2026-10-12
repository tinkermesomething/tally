/** Every language the picker offers (Settings > Account) and every
 * messages/*.json file that must exist - add a locale here, add its
 * message file, add it to the validation in lib/db/settings.ts, in that
 * order. Labels are in the language itself, not English - a picker that
 * only names "Italian" in English defeats the point of offering it. */
export const SUPPORTED_LOCALES = ["en", "it", "fr", "pt", "de", "pl"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  it: "Italiano",
  fr: "Français",
  pt: "Português",
  de: "Deutsch",
  pl: "Polski",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export const DEFAULT_LOCALE: Locale = "en";
