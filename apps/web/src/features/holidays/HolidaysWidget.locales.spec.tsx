// Verifies HolidaysWidget's actual RENDERED OUTPUT in ar/ku — same
// approach as login.locales.spec.tsx / ClockWidget.locales.spec.tsx.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { HolidaysWidget } from "./HolidaysWidget";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderWidget(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <HolidaysWidget />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "العطلات القادمة", empty: "لا توجد عطلات قادمة." },
  { locale: "ku" as const, title: "پشووە داهاتووەکان", empty: "هیچ پشوویەکی داهاتوو نییە." },
])("HolidaysWidget rendered in $locale", ({ locale, title, empty }) => {
  it("renders the real translated title with a ckb/ar-formatted, western-numeral date, dir=rtl", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "h1", name: "Iraq Republic Day", date: "2026-08-14T00:00:00.000Z", companyId: null },
    ]);
    renderWidget(locale);

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();

    // Western numerals enforced via the -u-nu-latn Intl tag (see locale.ts)
    // — real digits, not Eastern Arabic-Indic ones, for both ar and ckb.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/14/)).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });

  it("renders the real translated empty state", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderWidget(locale);

    expect(await screen.findByText(empty)).toBeInTheDocument();
  });
});
