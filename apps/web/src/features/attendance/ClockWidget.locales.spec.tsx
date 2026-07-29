// Verifies ClockWidget's actual RENDERED OUTPUT in ar/ku, not just that
// translation keys exist (locale-parity.spec.ts already covers that) — same
// approach as login.locales.spec.tsx.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { ClockWidget } from "./ClockWidget";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderWidget(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ClockWidget />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  {
    locale: "ar" as const,
    title: "حضور اليوم",
    notClockedIn: "لم تسجل حضورك اليوم بعد.",
    clockIn: "تسجيل الحضور",
    geofenceTitle: "خارج موقع العمل المحدد",
  },
  {
    locale: "ku" as const,
    title: "ئامادەبوونی ئەمڕۆ",
    notClockedIn: "هێشتا ئامادەبوونت تۆمار نەکردووە بۆ ئەمڕۆ.",
    clockIn: "تۆمارکردنی چوونە ژوورەوە",
    geofenceTitle: "دەرەوەی شوێنی کاری دیاریکراو",
  },
])("ClockWidget rendered in $locale", ({ locale, title, notClockedIn, clockIn, geofenceTitle }) => {
  it("renders the real translated title, status, and button, with dir=rtl on the widget root", async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    renderWidget(locale);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(notClockedIn)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: clockIn });
    expect(button).toBeInTheDocument();

    const root = button.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });

  it("renders the real translated geofence warning when the most recent record was flagged", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: "r1",
        employeeId: "e1",
        clockIn: "2026-07-28T09:04:00.000Z",
        clockOut: null,
        withinGeofence: false,
      },
    ]);
    renderWidget(locale);

    expect(await screen.findByText(geofenceTitle)).toBeInTheDocument();
  });
});
