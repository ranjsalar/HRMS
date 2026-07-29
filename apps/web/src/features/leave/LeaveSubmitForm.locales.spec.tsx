// Verifies LeaveSubmitForm's actual RENDERED OUTPUT in ar/ku, including
// the live working-days preview and date pickers — the founder flagged
// date-range pickers and numeric balance displays as the elements most
// likely to break under RTL/translation.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { Locale } from "@/lib/locale";
import { LeaveSubmitForm } from "./LeaveSubmitForm";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderForm(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LeaveSubmitForm onSubmitted={() => undefined} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  mockedApiFetch.mockImplementation(async (path) => {
    const p = String(path);
    if (p === "/leave-types") {
      return [{ id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true }];
    }
    if (p.startsWith("/leave-balances/me")) {
      return [{ id: "b1", employeeId: "e1", leaveTypeId: "lt1", year: 2026, balance: "5.00" }];
    }
    if (p.startsWith("/leave-requests/preview")) return { workingDays: 3 };
    throw new Error(`unexpected ${p}`);
  });
});

describe.each([
  { locale: "ar" as const, title: "طلب إجازة", preview: "سيتم خصم 3 يوم عمل" },
  { locale: "ku" as const, title: "داواکاری مۆڵەت", preview: "3 ڕۆژی کار کەم دەکرێتەوە" },
])("LeaveSubmitForm rendered in $locale", ({ locale, title, preview }) => {
  it("renders the real translated title with dir=rtl, and a western-numeral working-days preview after picking dates", async () => {
    renderForm(locale);

    const heading = await screen.findByText(title);
    const root = heading.closest("form[dir]");
    expect(root).toHaveAttribute("dir", "rtl");

    const [startInput, endInput] = screen.getAllByDisplayValue("");
    await userEvent.type(startInput, "2026-08-03");
    await userEvent.type(endInput, "2026-08-05");

    await waitFor(() => expect(screen.getByText(preview)).toBeInTheDocument());
  });
});
