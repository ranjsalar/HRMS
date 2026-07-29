/** Mirrors `apps/web/src/lib/locale.ts`'s `Locale` type — kept as a separate, tiny source of truth here rather than importing across the api/web boundary. */
export type Locale = "en" | "ar" | "ku";
export const LOCALES: readonly Locale[] = ["en", "ar", "ku"];
export const DEFAULT_LOCALE: Locale = "en";
