import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { LeaveSubmitForm } from "./LeaveSubmitForm";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);
const onSubmitted = vi.fn();

function renderForm() {
  return render(
    <LocaleProvider initialLocale="en">
      <LeaveSubmitForm onSubmitted={onSubmitted} />
    </LocaleProvider>,
  );
}

function mockBaseData(): void {
  mockedApiFetch.mockImplementation(async (path, options) => {
    const p = String(path);
    if (p === "/leave-types") {
      return [
        { id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true },
      ];
    }
    if (p.startsWith("/leave-balances/me")) {
      return [{ id: "b1", employeeId: "e1", leaveTypeId: "lt1", year: 2026, balance: "5.00" }];
    }
    if (p.startsWith("/leave-requests/preview")) {
      return { workingDays: 3 };
    }
    if (p === "/leave-requests" && options?.method === "POST") {
      return { id: "r1", employeeId: "e1", leaveTypeId: "lt1", startDate: "2026-08-03", endDate: "2026-08-05", status: "pending", workingDays: null, reason: null, createdAt: "2026-08-01" };
    }
    throw new Error(`unexpected path ${p}`);
  });
}

beforeEach(() => {
  mockedApiFetch.mockReset();
  onSubmitted.mockReset();
});

describe("LeaveSubmitForm", () => {
  it("shows client-side validation errors without calling the submit endpoint", async () => {
    mockBaseData();
    renderForm();
    await screen.findByText("Annual Leave");

    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findAllByText("This field is required.")).toHaveLength(3);
    expect(mockedApiFetch).not.toHaveBeenCalledWith("/leave-requests", expect.anything());
  });

  it("shows a live working-days preview and the balance for the selected type once both dates are picked", async () => {
    mockBaseData();
    renderForm();
    await screen.findByText("Annual Leave");

    await userEvent.selectOptions(screen.getByLabelText("Leave type"), "lt1");
    expect(await screen.findByText("5 day(s) remaining in this leave type")).toBeInTheDocument();

    const [startInput, endInput] = screen.getAllByDisplayValue("");
    await userEvent.type(startInput, "2026-08-03");
    await userEvent.type(endInput, "2026-08-05");

    expect(await screen.findByText("3 working day(s) will be deducted")).toBeInTheDocument();
  });

  it("submits successfully and resets the form", async () => {
    mockBaseData();
    renderForm();
    await screen.findByText("Annual Leave");

    await userEvent.selectOptions(screen.getByLabelText("Leave type"), "lt1");
    const [startInput, endInput] = screen.getAllByDisplayValue("");
    await userEvent.type(startInput, "2026-08-03");
    await userEvent.type(endInput, "2026-08-05");
    await waitFor(() => expect(screen.getByText("3 working day(s) will be deducted")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("Leave request submitted.")).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalledTimes(1);
  });

  it("shows the REAL server conflict message, not a generic failure, when the backend rejects the request", async () => {
    mockedApiFetch.mockImplementation(async (path, options) => {
      const p = String(path);
      if (p === "/leave-types") {
        return [{ id: "lt1", companyId: "c1", name: "Annual Leave", daysPerYear: 30, requiresApproval: true, paid: true, active: true }];
      }
      if (p.startsWith("/leave-balances/me")) return [];
      if (p.startsWith("/leave-requests/preview")) return { workingDays: 3 };
      if (p === "/leave-requests" && options?.method === "POST") {
        const { ConflictError } = await import("@/lib/api-client");
        throw new ConflictError(
          "This request overlaps an existing pending or approved leave request",
          409,
          null,
        );
      }
      throw new Error(`unexpected path ${p}`);
    });
    renderForm();
    await screen.findByText("Annual Leave");

    await userEvent.selectOptions(screen.getByLabelText("Leave type"), "lt1");
    const [startInput, endInput] = screen.getAllByDisplayValue("");
    await userEvent.type(startInput, "2026-08-03");
    await userEvent.type(endInput, "2026-08-05");
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(
      await screen.findByText("This request overlaps an existing pending or approved leave request"),
    ).toBeInTheDocument();
    expect(onSubmitted).not.toHaveBeenCalled();
  });
});
