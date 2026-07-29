// Verifies OrgChartView's actual RENDERED OUTPUT in ar/ku.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { OrgChartView } from "./OrgChartView";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderChart(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <OrgChartView />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "الهيكل التنظيمي", managerPrefix: "المدير: سارا" },
  { locale: "ku" as const, title: "پێکهاتەی ڕێکخراو", managerPrefix: "بەڕێوەبەر: سارا" },
])("OrgChartView rendered in $locale", ({ locale, title, managerPrefix }) => {
  it("renders the real translated title, department, and manager name with western-numeral employee count, dir=rtl", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "d1", name: "کارگێڕی", managerEmployeeId: "e1", managerName: "سارا", employeeCount: 4, children: [] },
    ]);
    renderChart(locale);

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(new RegExp(managerPrefix))).toBeInTheDocument();
    expect(screen.getByText(/4/)).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });
});
