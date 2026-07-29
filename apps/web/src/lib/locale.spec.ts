import { describe, expect, it } from "vitest";
import { formatDate, formatNumber, isLocale, LOCALE_DIR, resolveLocale } from "./locale";

describe("LOCALE_DIR", () => {
  it("en is ltr, ar and ku are rtl", () => {
    expect(LOCALE_DIR.en).toBe("ltr");
    expect(LOCALE_DIR.ar).toBe("rtl");
    expect(LOCALE_DIR.ku).toBe("rtl");
  });
});

describe("resolveLocale", () => {
  it("passes through a valid locale", () => {
    expect(resolveLocale("ar")).toBe("ar");
  });

  it("falls back to the default for anything invalid, missing, or absent", () => {
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale(null)).toBe("en");
    expect(resolveLocale("")).toBe("en");
  });
});

describe("isLocale", () => {
  it("recognizes exactly en/ar/ku", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("ku")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("formatNumber — Western numerals in every locale, per the project's confirmed numeral decision", () => {
  it("renders Western digits for ar (not Eastern Arabic-Indic ٠١٢٣)", () => {
    const formatted = formatNumber(12345.6, "ar");
    expect(formatted).toMatch(/^[0-9,.]+$/);
  });

  it("renders Western digits for ku/Sorani (not Eastern Arabic-Indic — this locale defaults to them without the numbering-system override)", () => {
    const formatted = formatNumber(12345.6, "ku");
    expect(formatted).toMatch(/^[0-9,.]+$/);
  });

  it("renders Western digits for en (the unremarkable baseline case)", () => {
    expect(formatNumber(1234, "en")).toBe("1,234");
  });
});

describe("formatDate — real locale-appropriate text, Western numerals", () => {
  const date = new Date("2026-07-28T00:00:00.000Z");

  it("uses Western numerals for the day/year components in ar and ku", () => {
    const ar = formatDate(date, "ar");
    const ku = formatDate(date, "ku");
    expect(ar).toContain("28");
    expect(ar).toContain("2026");
    expect(ku).toContain("28");
    expect(ku).toContain("2026");
    // No Eastern Arabic-Indic digit should appear anywhere in the output.
    expect(ar).not.toMatch(/[٠-٩]/);
    expect(ku).not.toMatch(/[٠-٩]/);
  });

  it("uses a real Sorani month name for ku, not an English fallback", () => {
    const ku = formatDate(date, "ku");
    // July in Sorani (تەمووز) — confirms the "ckb" Intl tag is actually
    // being used, not silently falling back to "ku" (unsupported) or "en".
    expect(ku).toContain("تەمووز");
  });
});
