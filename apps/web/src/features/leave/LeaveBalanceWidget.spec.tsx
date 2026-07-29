import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { LeaveBalanceWidget } from "./LeaveBalanceWidget";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function renderWidget() {
  return render(
    <LocaleProvider initialLocale="en">
      <LeaveBalanceWidget />
    </LocaleProvider>,
  );
}

function mockResponses(
  balances: unknown[],
  leaveTypes: unknown[],
): void {
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

describe("LeaveBalanceWidget", () => {
  it("joins balances with leave-type names and formats the remaining days", async () => {
    mockResponses(
      [
        { id: "b1", employeeId: "e1", leaveTypeId: "lt1", year: 2026, balance: "12.50" },
        { id: "b2", employeeId: "e1", leaveTypeId: "lt2", year: 2026, balance: "3.00" },
      ],
      [
        { id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true },
        { id: "lt2", companyId: "c1", name: "Sick Leave", daysPerYear: 14, requiresApproval: true, paid: true, active: true },
      ],
    );
    renderWidget();

    expect(await screen.findByText("Annual Leave")).toBeInTheDocument();
    expect(screen.getByText("12.5 days remaining")).toBeInTheDocument();
    expect(screen.getByText("Sick Leave")).toBeInTheDocument();
    expect(screen.getByText("3 days remaining")).toBeInTheDocument();
  });

  it("drops a balance whose leave type is no longer active, rather than showing a blank name", async () => {
    mockResponses(
      [{ id: "b1", employeeId: "e1", leaveTypeId: "lt-deactivated", year: 2026, balance: "5.00" }],
      [],
    );
    renderWidget();

    expect(await screen.findByText("No leave balances yet.")).toBeInTheDocument();
  });

  it("shows the empty state when there are no balances at all (e.g. a brand-new employee)", async () => {
    mockResponses([], [{ id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true }]);
    renderWidget();

    expect(await screen.findByText("No leave balances yet.")).toBeInTheDocument();
  });

  it("renders the generic error state with a working retry when either fetch fails", async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error("network down"));
    mockResponses([], []);
    renderWidget();

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No leave balances yet.")).toBeInTheDocument();
  });
});
