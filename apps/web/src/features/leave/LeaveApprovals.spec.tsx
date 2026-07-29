import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { LeaveApprovals } from "./LeaveApprovals";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

const TEAM = [
  { id: "e1", userId: "u1", fullName: "Alice", jobTitle: "Engineer", departmentId: "d1", branchId: "b1", hireDate: "2024-01-01T00:00:00.000Z", status: "active" },
];
const LEAVE_TYPES = [
  { id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true },
];

function renderApprovals() {
  return render(
    <LocaleProvider initialLocale="en">
      <LeaveApprovals />
    </LocaleProvider>,
  );
}

function mockBase(pending: unknown[]): void {
  mockedApiFetch.mockImplementation(async (path) => {
    const p = String(path);
    if (p === "/leave-requests?status=pending") return pending;
    if (p === "/employees") return TEAM;
    if (p === "/leave-types") return LEAVE_TYPES;
    if (p.startsWith("/leave-requests/preview")) return { workingDays: 3 };
    if (p.startsWith("/leave-balances?employeeId=")) {
      return [{ id: "b1", employeeId: "e1", leaveTypeId: "lt1", year: 2026, balance: "5.00" }];
    }
    throw new Error(`unexpected ${p}`);
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
});

describe("LeaveApprovals", () => {
  it("shows the empty state when there are no pending requests", async () => {
    mockBase([]);
    renderApprovals();
    expect(await screen.findByText("No pending leave requests.")).toBeInTheDocument();
  });

  it("renders the employee name, leave type, date range, working-days preview, and balance context for a pending request", async () => {
    mockBase([
      { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "pending", workingDays: null, reason: null, createdAt: "2026-08-01" },
    ]);
    renderApprovals();

    expect(await screen.findByText("Alice — Annual Leave")).toBeInTheDocument();
    expect(await screen.findByText("3 working day(s) will be deducted")).toBeInTheDocument();
    expect(screen.getByText("5 day(s) remaining in this leave type")).toBeInTheDocument();
  });

  it("approving removes the row from the list (real server call, not just a local toggle)", async () => {
    mockBase([
      { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "pending", workingDays: null, reason: null, createdAt: "2026-08-01" },
    ]);
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/leave-requests?status=pending") {
        return [{ id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "pending", workingDays: null, reason: null, createdAt: "2026-08-01" }];
      }
      if (p === "/employees") return TEAM;
      if (p === "/leave-types") return LEAVE_TYPES;
      if (p.startsWith("/leave-requests/preview")) return { workingDays: 3 };
      if (p.startsWith("/leave-balances?employeeId=")) {
        return [{ id: "b1", employeeId: "e1", leaveTypeId: "lt1", year: 2026, balance: "5.00" }];
      }
      if (p === "/leave-requests/r1/approve" && options?.method === "POST") {
        return { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "approved", workingDays: "3", reason: null, createdAt: "2026-08-01" };
      }
      throw new Error(`unexpected ${p}`);
    });
    renderApprovals();

    await screen.findByText("Alice — Annual Leave");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByText("No pending leave requests.")).toBeInTheDocument();
  });

  it("shows the real server conflict message inline when approval is rejected (insufficient balance), and the row stays", async () => {
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/leave-requests?status=pending") {
        return [{ id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "pending", workingDays: null, reason: null, createdAt: "2026-08-01" }];
      }
      if (p === "/employees") return TEAM;
      if (p === "/leave-types") return LEAVE_TYPES;
      if (p.startsWith("/leave-requests/preview")) return { workingDays: 3 };
      if (p.startsWith("/leave-balances?employeeId=")) return [];
      if (p === "/leave-requests/r1/approve" && options?.method === "POST") {
        const { ConflictError } = await import("@/lib/api-client");
        throw new ConflictError("Insufficient leave balance: requesting 3 working day(s), 0 remaining.", 409, null);
      }
      throw new Error(`unexpected ${p}`);
    });
    renderApprovals();

    const row = (await screen.findByText("Alice — Annual Leave")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Approve" }));

    expect(
      await within(row).findByText("Insufficient leave balance: requesting 3 working day(s), 0 remaining."),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice — Annual Leave")).toBeInTheDocument();
  });
});
