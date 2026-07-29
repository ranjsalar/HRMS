"use client";

import { LOCALES } from "@/lib/locale";
import { useLocale } from "@/lib/locale-context";

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="flex gap-2">
      {LOCALES.map((code) => (
        <button
          key={code}
          type="button"
          onClick={() => setLocale(code)}
          aria-pressed={code === locale}
          className={`rounded-md border px-3 py-1 font-body text-sm ${
            code === locale ? "border-primary text-primary" : "border-neutral-300 text-neutral-900"
          }`}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
