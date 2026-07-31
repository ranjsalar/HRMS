import type { Locale } from "./locale.type";

/**
 * Mirrors apps/web/src/lib/locale.ts's own INTL_TAG mapping — this is the
 * first backend email needing a formatted date at all (password-reset/
 * welcome emails never interpolated one). Same reasoning duplicated here
 * rather than shared across the api/web boundary, matching this
 * codebase's existing "small, deliberately duplicated i18n primitives"
 * convention (see locale.type.ts's own comment). "ku" alone has patchy
 * ICU coverage; "ckb" (Sorani, Perso-Arabic script) is the specific tag
 * with real CLDR data. `-u-nu-latn` forces Western numerals on both, per
 * this project's confirmed numeral decision (see DECISIONS.md, step 1).
 */
const INTL_TAG: Record<Locale, string> = {
  en: "en",
  ar: "ar-u-nu-latn",
  ku: "ckb-u-nu-latn",
};

export function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
