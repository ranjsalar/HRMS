// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running (`pnpm --filter @hrms/api dev`) with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied (that
// script now also creates a real "Annual Leave" LeaveType for this
// company — see DECISIONS.md, step 9.3).
import { useCallback, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import type { LeaveRequestDto } from "./leave-requests-api";
import { LeaveRequestHistory } from "./LeaveRequestHistory";
import { LeaveSubmitForm } from "./LeaveSubmitForm";

const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}

function LeavePageForTest() {
  const [refreshToken, setRefreshToken] = useState(0);
  const onSubmitted = useCallback(() => setRefreshToken((n) => n + 1), []);
  return (
    <LocaleProvider initialLocale="en">
      <LeaveSubmitForm onSubmitted={onSubmitted} />
      <LeaveRequestHistory refreshToken={refreshToken} />
    </LocaleProvider>
  );
}

// A different, far-future date range every run (seeded by the current
// time) — this fixture employee is fixed, not per-run, so a hardcoded
// date range would collide with a request an earlier run left behind
// (submit's overlap check is real and would 409 against it).
function futureDateRange(): { start: string; end: string } {
  const offsetDays = 90 + (Date.now() % 200);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

beforeAll(async () => {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  setAccessToken(res.accessToken);
}, 15000);

afterAll(() => {
  setAccessToken(null);
});

describe("Leave submit + history + cancel — real backend integration", () => {
  it("submits a real leave request against the real backend, sees it in real history, and cancels it", async () => {
    const { start, end } = futureDateRange();
    const { container } = render(<LeavePageForTest />);

    // findByRole("option", ...), not findByText — the accumulated history
    // list also renders "Annual Leave" as each past row's type name, which
    // makes a plain text query ambiguous once more than a couple of runs
    // have happened. This scopes to the SELECT's own option, unambiguous
    // regardless of how much history exists.
    await screen.findByRole("option", { name: "Annual Leave" }, { timeout: 10000 });
    await userEvent.selectOptions(screen.getByLabelText("Leave type"), "Annual Leave");

    const dateInputs = screen.getAllByDisplayValue("");
    await userEvent.type(dateInputs[0], start);
    await userEvent.type(dateInputs[1], end);

    await waitFor(() => expect(screen.getByText(/working day\(s\) will be deducted/)).toBeInTheDocument(), {
      timeout: 10000,
    });

    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(await screen.findByText("Leave request submitted.", {}, { timeout: 10000 })).toBeInTheDocument();

    // This fixture employee's history accumulates real rows across every
    // past run of this test (accepted trade-off, same as the attendance/
    // dashboard integration tests — see DECISIONS.md) — likely MULTIPLE
    // pending/cancelled rows already exist. Scoped to THIS run's own row
    // via its real id, not any rendered text: an earlier version of this
    // test matched by formatted date-range text, which broke once the
    // history had accumulated enough runs that a random-offset collision
    // became likely (same root cause the payslips integration test hit
    // with an even smaller date-bucket space — see DECISIONS.md). Nothing
    // else could have created a newer request for this employee between
    // the submit above and this lookup (tests run sequentially, not in
    // parallel — see vitest.config.ts), so "most recently created" IS
    // "this run's own row."
    const mine = await apiFetch<LeaveRequestDto[]>("/leave-requests/me");
    const myRequestId = mine[0].id;
    let row: HTMLElement | null = null;
    await waitFor(
      () => {
        row = container.querySelector(`[data-request-id="${myRequestId}"]`);
        expect(row).not.toBeNull();
      },
      { timeout: 10000 },
    );

    const cancelButton = within(row!).getByRole("button", { name: "Cancel request" });
    await userEvent.click(cancelButton);

    await waitFor(() => expect(within(row!).queryByRole("button")).not.toBeInTheDocument(), {
      timeout: 10000,
    });
    expect(within(row!).getByText("Cancelled")).toBeInTheDocument();
  }, 45000);

  it("a real overlapping request is rejected with the real, dynamic server message", async () => {
    const { start, end } = futureDateRange();

    // First request goes through directly via the API (not through the
    // UI) so this test doesn't depend on the previous test's timing/state.
    await apiFetch("/leave-requests", {
      method: "POST",
      body: { leaveTypeId: (await apiFetch<{ id: string; name: string }[]>("/leave-types")).find(
        (t) => t.name === "Annual Leave",
      )!.id, startDate: start, endDate: end },
    });

    render(<LeavePageForTest />);
    await screen.findByRole("option", { name: "Annual Leave" }, { timeout: 20000 });
    await userEvent.selectOptions(screen.getByLabelText("Leave type"), "Annual Leave");

    const dateInputs = screen.getAllByDisplayValue("");
    await userEvent.type(dateInputs[0], start);
    await userEvent.type(dateInputs[1], end);
    await userEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(
      await screen.findByText(
        "This request overlaps an existing pending or approved leave request",
        {},
        { timeout: 20000 },
      ),
    ).toBeInTheDocument();

    // Clean up: cancel the request created directly via the API above so
    // it doesn't linger and collide with a LATER run's own date math
    // (unlikely given the wide random offset, but cheap to guarantee).
    const mine = await apiFetch<{ id: string; status: string; startDate: string }[]>(
      "/leave-requests/me",
    );
    const created = mine.find((r) => r.startDate.startsWith(start) && r.status === "pending");
    if (created) {
      await apiFetch(`/leave-requests/${created.id}/cancel`, { method: "POST" });
    }
  }, 45000);
});
