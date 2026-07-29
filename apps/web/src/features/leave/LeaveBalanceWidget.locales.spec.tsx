// Verifies LeaveBalanceWidget's actual RENDERED OUTPUT in ar/ku — same
// approach as login.locales.spec.tsx / ClockWidget.locales.spec.tsx.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { LeaveBalanceWidget } from "./LeaveBalanceWidget";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderWidget(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LeaveBalanceWidget />
    </LocaleProvider>,
  );
}

function mockResponses(balances: unknown[], leaveTypes: unknown[]): void {
  mockedApiFetch.mockImplementation(async (path) => {
    const p = String(path);
    if (p.startsWith("/leave-balances/me")) return balances;
    if (p === "/leave-types") return leaveTypes;
    throw new Error(`unexpected path ${p}`);
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "رصيد الإجازات", empty: "لا يوجد رصيد إجازات بعد.", suffix: "يوم متبقٍ" },
  { locale: "ku" as const, title: "پاشماوەی مۆڵەت", empty: "هێشتا هیچ پاشماوەیەکی مۆڵەت نییە.", suffix: "ڕۆژ ماوە" },
])("LeaveBalanceWidget rendered in $locale", ({ locale, title, empty, suffix }) => {
  it("renders the real translated title and a joined row with western-numeral days remaining, dir=rtl", async () => {
    mockResponses(
      [{ id: "b1", employeeId: "e1", leaveTypeId: "lt1", year: 2026, balance: "7.00" }],
      [
        {
          id: "lt1",
          companyId: "c1",
          name: locale === "ar" ? "إجازة سنوية" : "مۆڵەتی ساڵانە",
          daysPerYear: 30,
          requiresApproval: true,
          paid: true,
          active: true,
        },
      ],
    );
    renderWidget(locale);

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(`7 ${suffix}`)).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });

  it("renders the real translated empty state", async () => {
    mockResponses([], []);
    renderWidget(locale);

    expect(await screen.findByText(empty)).toBeInTheDocument();
  });
});
