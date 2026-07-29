// Verifies DocumentsPanel's actual RENDERED OUTPUT in ar/ku.
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { DocumentsPanel } from "./DocumentsPanel";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

const PROFILE = {
  id: "e1",
  fullName: "Jane Doe",
  jobTitle: "Analyst",
  hireDate: "2024-01-01T00:00:00.000Z",
  status: "active",
  phone: null,
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
};

function renderPanel(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <DocumentsPanel />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "المستندات", uploadTitle: "رفع مستند", typeLabel: "عقد" },
  { locale: "ku" as const, title: "بەڵگەنامەکان", uploadTitle: "بارکردنی بەڵگەنامە", typeLabel: "گرێبەست" },
])("DocumentsPanel rendered in $locale", ({ locale, title, uploadTitle, typeLabel }) => {
  it("renders the real translated titles and a document row's translated type, dir=rtl", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/employees/me") return PROFILE;
      if (p === "/documents/me") {
        return [{ id: "d1", employeeId: "e1", type: "contract", expiryDate: null, uploadedAt: "2026-01-01T00:00:00.000Z" }];
      }
      throw new Error(`unexpected ${p}`);
    });
    renderPanel(locale);

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(uploadTitle)).toBeInTheDocument();

    const list = screen.getByRole("list");
    expect(within(list).getByText(typeLabel)).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });
});
