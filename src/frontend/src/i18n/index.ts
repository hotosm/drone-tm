import { getLocale, setLocale, locales, baseLocale } from "@/paraglide/runtime";

export { getLocale, setLocale, locales, baseLocale };

export const localeNames: Record<string, string> = {
  en: "English",
  es: "Español",
  id: "Bahasa Indonesia",
};

export function getLocaleDisplayName(locale: string): string {
  return localeNames[locale] ?? locale;
}
