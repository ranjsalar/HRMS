"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import en from "@/locales/en.json";
import ar from "@/locales/ar.json";
import ku from "@/locales/ku.json";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_DIR, type Locale } from "./locale";

const TRANSLATIONS: Record<Locale, Record<string, unknown>> = { en, ar, ku };

function lookup(obj: Record<string, unknown>, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
  return typeof value === "string" ? value : undefined;
}

type TranslationParams = Record<string, string | number>;

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

interface LocaleContextValue {
  locale: Locale;
  dir: "ltr" | "rtl";
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Writes a plain (non-httpOnly — this is a UI preference, not a
  // credential) cookie so the NEXT server render (a fresh navigation, a
  // reload) picks up the choice via layout.tsx reading cookies()
  // server-side, avoiding an LTR->RTL flash. Also flips dir/lang on the
  // already-mounted <html> immediately, so the CURRENT page updates
  // without waiting for a round-trip.
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    document.documentElement.dir = LOCALE_DIR[next];
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams): string => {
      const value = lookup(TRANSLATIONS[locale], key) ?? lookup(TRANSLATIONS[DEFAULT_LOCALE], key);
      if (value === undefined) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`[i18n] Missing translation key "${key}" in every locale.`);
        }
        return key;
      }
      return interpolate(value, params);
    },
    [locale],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: LOCALE_DIR[locale], setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return ctx;
}

/** The hook screens actually use — `t()` plus the two things almost every screen also needs (current locale, direction). */
export function useTranslation(): Pick<LocaleContextValue, "t" | "locale" | "dir"> {
  const { t, locale, dir } = useLocale();
  return { t, locale, dir };
}
