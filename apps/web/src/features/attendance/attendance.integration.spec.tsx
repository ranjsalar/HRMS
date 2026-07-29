// Real-backend integration test — apiFetch is NOT mocked here, unlike
// ClockWidget.spec.tsx. Requires the API dev server running
// (`pnpm --filter @hrms/api dev`) with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied (that
// script now also creates an Employee row + Branch/Department for this
// user — see DECISIONS.md, step 9.2).
//
// Credentials duplicated from
// apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on purpose,
// same convention as login.integration.spec.tsx — keep in sync by hand.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { ClockWidget } from "./ClockWidget";

const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}

function renderWidget() {
  return render(
    <LocaleProvider initialLocale="en">
      <ClockWidget />
    </LocaleProvider>,
  );
}

/**
 * AttendanceService.clockIn looks for ANY open record for this employee,
 * not just today's — a previous test run that crashed mid-cycle (clocked
 * in, never clocked out) would otherwise permanently block every future
 * run with "Already clocked in." Swallowing the 409 this throws when
 * nothing is open makes both the setup and every test in this file
 * idempotent regardless of what state a prior run left behind.
 */
async function closeAnyOpenRecord(): Promise<void> {
  try {
    await apiFetch("/attendance/clock-out", { method: "POST", body: {} });
  } catch {
    // nothing open — already clean
  }
}

beforeAll(async () => {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  setAccessToken(res.accessToken);
  await closeAnyOpenRecord();
}, 15000);

afterAll(async () => {
  await closeAnyOpenRecord();
  setAccessToken(null);
});

describe("ClockWidget — real backend integration", () => {
  // Doesn't assert "You haven't clocked in today" as the starting state —
  // this fixture employee is fixed (not per-run, unlike backend e2e
  // fixtures), so re-running this test later the same calendar day would
  // find an earlier run's already-CLOSED record for today, not zero
  // records. closeAnyOpenRecord() only guarantees no OPEN record (so the
  // widget is always showing the "Clock in" button to start), not that
  // today has no history at all.
  it("clocks in and out against the real API, reflecting the real record's state and timestamps", async () => {
    renderWidget();

    expect(
      await screen.findByRole("button", { name: "Clock in" }, { timeout: 10000 }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clock in" }));
    expect(
      await screen.findByRole("button", { name: "Clock out" }, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Clocked in at/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clock out" }));
    expect(
      await screen.findByRole("button", { name: "Clock in" }, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Clocked out at/)).toBeInTheDocument();
  }, 20000);

  it("a fresh mount reflects an already-open record from the real backend, not just post-action state updates", async () => {
    // Clocks in directly via the real API (not through this render), then
    // mounts the widget fresh — exercises the initial GET /attendance/me
    // load path specifically, since the test above only ever observes
    // state after this component's own actions.
    await apiFetch("/attendance/clock-in", { method: "POST", body: {} });

    renderWidget();

    expect(
      await screen.findByRole("button", { name: "Clock out" }, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Clocked in at/)).toBeInTheDocument();

    await closeAnyOpenRecord();
  }, 15000);
});
