// Verifies ProfileView's actual RENDERED OUTPUT in ar/ku.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { ProfileView } from "./ProfileView";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderView(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ProfileView />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  mockedApiFetch.mockResolvedValueOnce({
    id: "e1",
    fullName: "دانا احمد",
    jobTitle: "شارەزا",
    hireDate: "2024-01-01T00:00:00.000Z",
    status: "active",
    phone: null,
    address: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
  });
});

describe.each([
  { locale: "ar" as const, title: "ملفي الشخصي", editTitle: "معلومات التواصل", phoneLabel: "الهاتف" },
  { locale: "ku" as const, title: "پرۆفایلی من", editTitle: "زانیاری پەیوەندی", phoneLabel: "ژمارەی تەلەفۆن" },
])("ProfileView rendered in $locale", ({ locale, title, editTitle, phoneLabel }) => {
  it("renders the real translated section titles and field labels, dir=rtl", async () => {
    renderView(locale);

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(editTitle)).toBeInTheDocument();
    expect(screen.getByLabelText(phoneLabel)).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });
});
