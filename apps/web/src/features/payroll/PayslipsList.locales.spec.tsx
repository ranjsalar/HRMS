// Verifies PayslipsList's actual RENDERED OUTPUT in ar/ku — the founder
// flagged numeric balance/currency displays as an element likely to break
// under RTL/translation.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { PayslipsList } from "./PayslipsList";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderList(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <PayslipsList />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "قسائم الراتب", empty: "لا توجد قسائم رواتب بعد." },
  { locale: "ku" as const, title: "فیشی موچە", empty: "هێشتا هیچ فیشی موچە نییە." },
])("PayslipsList rendered in $locale", ({ locale, title, empty }) => {
  it("renders the real translated title and a western-numeral gross/net figure, dir=rtl", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: "p1",
        employeeId: "e1",
        payrollRunId: "r1",
        gross: "1500000.00",
        deductions: "75000.00",
        net: "1425000.00",
        currency: "IQD",
        pdfUrl: "companyid/p1.pdf",
        generatedAt: "2026-08-01T00:00:00.000Z",
        payrollRun: { periodStart: "2026-07-01T00:00:00.000Z", periodEnd: "2026-07-31T00:00:00.000Z" },
      },
    ]);

    renderList(locale);
    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();

    // Western numerals enforced via -u-nu-latn (see locale.ts) — real
    // digits, not Eastern Arabic-Indic ones, for both ar and ckb.
    expect(screen.getByText(/1,500,000\.00 IQD/)).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });

  it("renders the real translated empty state", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderList(locale);
    expect(await screen.findByText(empty)).toBeInTheDocument();
  });
});
