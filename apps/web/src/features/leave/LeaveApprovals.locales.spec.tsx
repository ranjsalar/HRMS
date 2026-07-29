// Verifies LeaveApprovals' actual RENDERED OUTPUT in ar/ku.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { LeaveApprovals } from "./LeaveApprovals";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderApprovals(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LeaveApprovals />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe.each([
  { locale: "ar" as const, title: "طلبات الإجازة المعلّقة", approve: "الموافقة", empty: "لا توجد طلبات إجازة معلّقة." },
  { locale: "ku" as const, title: "داواکاری مۆڵەتی چاوەڕوان", approve: "پەسەندکردن", empty: "هیچ داواکاریەکی مۆڵەتی چاوەڕوان نییە." },
])("LeaveApprovals rendered in $locale", ({ locale, title, approve, empty }) => {
  it("renders the real translated title and Approve button for a pending request, dir=rtl", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/leave-requests?status=pending") {
        return [{ id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "pending", workingDays: null, reason: null, createdAt: "2026-08-01" }];
      }
      if (p === "/employees") {
        return [{ id: "e1", userId: "u1", fullName: "سارا", jobTitle: "Engineer", departmentId: "d1", branchId: "b1", hireDate: "2024-01-01T00:00:00.000Z", status: "active" }];
      }
      if (p === "/leave-types") {
        return [{ id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true }];
      }
      if (p.startsWith("/leave-requests/preview")) return { workingDays: 3 };
      if (p.startsWith("/leave-balances?employeeId=")) return [];
      throw new Error(`unexpected ${p}`);
    });
    renderApprovals(locale);

    const heading = await screen.findByText(title);
    expect(heading).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: approve })).toBeInTheDocument();

    const root = heading.closest("div[dir]");
    expect(root).toHaveAttribute("dir", "rtl");
  });

  it("renders the real translated empty state", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/leave-requests?status=pending") return [];
      if (p === "/employees") return [];
      if (p === "/leave-types") return [];
      throw new Error(`unexpected ${p}`);
    });
    renderApprovals(locale);
    expect(await screen.findByText(empty)).toBeInTheDocument();
  });
});
