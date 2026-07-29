// Verifies TeamList + AttendanceCorrectionForm's actual RENDERED OUTPUT
// in ar/ku.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { AttendanceCorrectionForm } from "./AttendanceCorrectionForm";
import { TeamList } from "./TeamList";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "الفريق", status: "نشط", formTitle: "تصحيح الحضور لـ سارا" },
  { locale: "ku" as const, title: "تیم", status: "چالاک", formTitle: "چاککردنەوەی ئامادەبوون بۆ سارا" },
])("Team screens rendered in $locale", ({ locale, title, status, formTitle }) => {
  it("TeamList renders the real translated title and status, dir=rtl", async () => {
    mockedApiFetch.mockResolvedValueOnce([
      { id: "e1", userId: "u1", fullName: "سارا", jobTitle: "Engineer", departmentId: "d1", branchId: "b1", hireDate: "2024-01-01T00:00:00.000Z", status: "active" },
    ]);
    render(
      <LocaleProvider initialLocale={locale}>
        <TeamList />
      </LocaleProvider>,
    );

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();
    expect(screen.getByText(new RegExp(status))).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });

  it("AttendanceCorrectionForm renders the real translated title with the employee's name interpolated, dir=rtl", () => {
    render(
      <LocaleProvider initialLocale={locale}>
        <AttendanceCorrectionForm employeeId="e1" employeeName="سارا" onClose={() => undefined} />
      </LocaleProvider>,
    );

    const heading = screen.getByText(formTitle);
    expect(heading).toBeInTheDocument();
    const root = heading.closest("form[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });
});
