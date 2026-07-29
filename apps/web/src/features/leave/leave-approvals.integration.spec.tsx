// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied (manager
// + out-of-scope-employee fixtures from step 9.5 are reused here).
import { authenticator } from "otplib";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { LeaveApprovals } from "./LeaveApprovals";

const MANAGER_EMAIL = "frontend-e2e-manager@hrms.test";
const MANAGER_PASSWORD = "Frontend-E2E-Manager-Pass-1";
const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";
const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
}

function futureDateRange(): { start: string; end: string } {
  const offsetDays = 300 + (Date.now() % 200);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + offsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function renderApprovals() {
  return render(
    <LocaleProvider initialLocale="en">
      <LeaveApprovals />
    </LocaleProvider>,
  );
}

async function loginAdmin(): Promise<string> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (res.status === "ok") return res.accessToken;
  const code = authenticator.generate(ADMIN_TOTP_SECRET);
  const verify = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
    method: "POST",
    body: { pendingToken: res.pendingToken, code },
  });
  return verify.accessToken;
}

afterAll(() => {
  setAccessToken(null);
});

describe("LeaveApprovals — real backend integration", () => {
  it("a manager sees a real pending request with real preview/balance context, and approving it removes it from the real queue", async () => {
    const { start, end } = futureDateRange();

    const employeeLogin = await apiFetch<LoginOkResponse>("/auth/login", {
      method: "POST",
      body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
    });
    setAccessToken(employeeLogin.accessToken);
    const leaveTypes = await apiFetch<{ id: string; name: string }[]>("/leave-types");
    const annualLeaveTypeId = leaveTypes.find((t) => t.name === "Annual Leave")!.id;
    const created = await apiFetch<{ id: string }>("/leave-requests", {
      method: "POST",
      body: { leaveTypeId: annualLeaveTypeId, startDate: start, endDate: end },
    });

    const managerLogin = await apiFetch<LoginOkResponse>("/auth/login", {
      method: "POST",
      body: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
    });
    setAccessToken(managerLogin.accessToken);

    const { container } = renderApprovals();

    // Scoped to THIS run's own row via its real id (not rendered text —
    // "Frontend E2E Employee — Annual Leave" would be ambiguous once more
    // than one pending request happens to exist at once, same lesson as
    // every other real-backend test against this fixture — see
    // DECISIONS.md), even though this queue self-cleans on approve/cancel
    // in the normal case.
    let row: HTMLElement | null = null;
    await waitFor(
      () => {
        row = container.querySelector(`li[data-request-id="${created.id}"]`);
        expect(row).not.toBeNull();
      },
      { timeout: 15000 },
    );
    expect(within(row!).getByText("Frontend E2E Employee — Annual Leave")).toBeInTheDocument();

    await within(row!).findByText(/working day\(s\) will be deducted/, {}, { timeout: 10000 });
    await userEvent.click(within(row!).getByRole("button", { name: "Approve" }));

    await waitFor(
      () => expect(container.querySelector(`li[data-request-id="${created.id}"]`)).not.toBeInTheDocument(),
      { timeout: 10000 },
    );
  }, 30000);

  it("an admin's OWN submitted request never appears in their own approval queue (server-side exclusion, step 9.6)", async () => {
    const adminToken = await loginAdmin();
    setAccessToken(adminToken);

    const { start, end } = futureDateRange();
    const leaveTypes = await apiFetch<{ id: string; name: string }[]>("/leave-types");
    const annualLeaveTypeId = leaveTypes.find((t) => t.name === "Annual Leave")!.id;
    const created = await apiFetch<{ id: string }>("/leave-requests", {
      method: "POST",
      body: { leaveTypeId: annualLeaveTypeId, startDate: start, endDate: end },
    });

    try {
      const { container } = renderApprovals();

      // Give the real fetch(es) time to land, then assert the row for
      // THIS admin's own just-created request is never present — not
      // just "not yet," but genuinely absent once loading has settled.
      await screen.findByText(/Pending leave approvals|No pending leave requests\./, {}, { timeout: 15000 });
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(container.querySelector(`li[data-request-id="${created.id}"]`)).toBeNull();
    } finally {
      await apiFetch(`/leave-requests/${created.id}/cancel`, { method: "POST" });
    }
  }, 30000);
});
