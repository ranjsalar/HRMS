export const LOCALES = ["en", "ar", "ku"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "hrms_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return LOCALES.includes(value as Locale);
}

/** Used server-side (layout.tsx reading the locale cookie) and anywhere else an untrusted/possibly-absent string needs to become a real Locale. */
export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export const LOCALE_DIR: Record<Locale, "ltr" | "rtl"> = {
  en: "ltr",
  ar: "rtl",
  ku: "rtl",
};

/**
 * BCP-47 tags for Intl.*, distinct from our internal locale codes:
 * - "ku" alone is a deprecated/ambiguous macrolanguage tag with patchy
 *   ICU coverage; "ckb" (Central Kurdish/Sorani, Perso-Arabic script) is
 *   the specific tag that actually matches ku.json's content and has real
 *   CLDR data (verified: produces correct Sorani month names).
 * - `-u-nu-latn` forces WESTERN numerals on both — per the project's
 *   confirmed numeral decision (see DECISIONS.md, step 1 and here).
 *   Verified necessary for ckb (defaults to Eastern Arabic-Indic digits
 *   otherwise); included for ar too rather than relying on it happening
 *   to already default to Western in this environment's ICU data, which
 *   is not guaranteed to hold in every deployment target.
 */
const INTL_TAG: Record<Locale, string> = {
  en: "en",
  ar: "ar-u-nu-latn",
  ku: "ckb-u-nu-latn",
};

export function formatDate(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" },
): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], options).format(date);
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(INTL_TAG[locale], options).format(value);
}
