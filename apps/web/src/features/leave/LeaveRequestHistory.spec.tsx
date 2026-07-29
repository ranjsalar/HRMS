import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { LeaveRequestHistory } from "./LeaveRequestHistory";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);
const LEAVE_TYPES = [
  { id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true },
];

function renderHistory(refreshToken = 0) {
  return render(
    <LocaleProvider initialLocale="en">
      <LeaveRequestHistory refreshToken={refreshToken} />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("LeaveRequestHistory", () => {
  it("shows the empty state when there are no requests", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/leave-requests/me") return [];
      if (p === "/leave-types") return LEAVE_TYPES;
      throw new Error(`unexpected ${p}`);
    });
    renderHistory();
    expect(await screen.findByText("You haven't submitted any leave requests yet.")).toBeInTheDocument();
  });

  it("shows a Cancel button ONLY for pending requests — not for approved/rejected/cancelled", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      const p = String(path);
      if (p === "/leave-requests/me") {
        return [
          { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-01", endDate: "2026-08-02", status: "pending", workingDays: null, reason: null, createdAt: "2026-07-30" },
          { id: "r2", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-07-01", endDate: "2026-07-02", status: "approved", workingDays: "2", reason: null, createdAt: "2026-06-30" },
          { id: "r3", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-06-01", endDate: "2026-06-02", status: "rejected", workingDays: null, reason: null, createdAt: "2026-05-30" },
          { id: "r4", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-05-01", endDate: "2026-05-02", status: "cancelled", workingDays: null, reason: null, createdAt: "2026-04-30" },
        ];
      }
      if (p === "/leave-types") return LEAVE_TYPES;
      throw new Error(`unexpected ${p}`);
    });
    renderHistory();

    await screen.findByText("Pending");
    // Exactly one Cancel button — the pending row's — never rendered at
    // all for the other three, not just disabled/hidden.
    expect(screen.getAllByRole("button", { name: "Cancel request" })).toHaveLength(1);
  });

  it("cancelling updates the row's status in place", async () => {
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/leave-requests/me") {
        return [
          { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-01", endDate: "2026-08-02", status: "pending", workingDays: null, reason: null, createdAt: "2026-07-30" },
        ];
      }
      if (p === "/leave-types") return LEAVE_TYPES;
      if (p === "/leave-requests/r1/cancel" && options?.method === "POST") {
        return { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-01", endDate: "2026-08-02", status: "cancelled", workingDays: null, reason: null, createdAt: "2026-07-30" };
      }
      throw new Error(`unexpected ${p}`);
    });
    renderHistory();

    await userEvent.click(await screen.findByRole("button", { name: "Cancel request" }));

    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();
  });
});
