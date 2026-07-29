type Locale = Record<string, unknown>;

function flattenKeys(obj: Locale, prefix = ""): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of flattenKeys(value as Locale, fullKey)) {
        keys.add(nested);
      }
    } else {
      keys.add(fullKey);
    }
  }
  return keys;
}

export interface LocaleParityResult {
  ok: boolean;
  missingByLocale: Record<string, string[]>;
}

/**
 * Compares translation key sets across locales and reports any keys
 * missing from one locale relative to the union of all locales.
 */
export function checkLocaleParity(locales: Record<string, Locale>): LocaleParityResult {
  const keySets = Object.entries(locales).map(([name, obj]) => [name, flattenKeys(obj)] as const);

  const unionKeys = new Set<string>();
  for (const [, keys] of keySets) {
    for (const key of keys) unionKeys.add(key);
  }

  const missingByLocale: Record<string, string[]> = {};
  for (const [name, keys] of keySets) {
    const missing = [...unionKeys].filter((key) => !keys.has(key));
    if (missing.length > 0) {
      missingByLocale[name] = missing.sort();
    }
  }

  return { ok: Object.keys(missingByLocale).length === 0, missingByLocale };
}
