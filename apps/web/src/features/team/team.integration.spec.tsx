// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied (that
// script now also creates a manager fixture + a second department with an
// out-of-scope employee — see DECISIONS.md, step 9.5).
import { useState } from "react";
import { authenticator } from "otplib";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { AttendanceCorrectionForm } from "./AttendanceCorrectionForm";
import { TeamList } from "./TeamList";
import type { TeamMemberDto } from "./team-api";

const MANAGER_EMAIL = "frontend-e2e-manager@hrms.test";
const MANAGER_PASSWORD = "Frontend-E2E-Manager-Pass-1";
const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const IN_SCOPE_NAME = "Frontend E2E Employee";
const OUT_OF_SCOPE_NAME = "Frontend E2E Out-of-Scope Employee";

/**
 * A `datetime-local` value guaranteed to fall on a PAST calendar day, in
 * every timezone, relative to whenever this test actually runs.
 *
 * A hardcoded absolute date here ("2026-08-01T09:00") previously caused a
 * real bug once real time caught up to it: this correction targets the
 * SAME shared, persistent "frontend-e2e-employee" fixture that
 * attendance.integration.spec.tsx's real clock-in/out tests use, and
 * that file's `fetchTodayAttendance()` picks the single most-recent-
 * clockIn record for "today" (UTC). Once the hardcoded date became
 * "today," this correction's fixed clock-in time (09:00) sorted AHEAD of
 * the real freshly-created open record from a same-day test run started
 * later that same morning, so the widget showed the correction's (closed)
 * state instead — a real, reproducible cross-test-file bug, not a flake.
 * Computing a date safely 2 days in the past (well clear of any
 * timezone-offset edge, from UTC-12 to UTC+14) means this record can
 * never again land inside any "today" range, on any date, in any
 * timezone. See DECISIONS.md.
 */
function pastDateTimeLocalString(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
}

/** Only ever used to LOOK UP the out-of-scope employee's real id — never to perform the override attempt itself, which must happen under the MANAGER's own session to mean anything. */
async function fetchOutOfScopeEmployeeId(): Promise<string> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  let adminToken: string;
  if (res.status === "ok") {
    adminToken = res.accessToken;
  } else {
    const code = authenticator.generate(ADMIN_TOTP_SECRET);
    const verify = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
      method: "POST",
      body: { pendingToken: res.pendingToken, code },
    });
    adminToken = verify.accessToken;
  }
  setAccessToken(adminToken);
  const all = await apiFetch<{ id: string; fullName: string }[]>("/employees");
  const target = all.find((e) => e.fullName === OUT_OF_SCOPE_NAME);
  if (!target) throw new Error("Expected the out-of-scope fixture employee to exist");
  return target.id;
}

function TeamPageForTest() {
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  return (
    <LocaleProvider initialLocale="en">
      <TeamList
        renderRowAction={(member: TeamMemberDto) =>
          correctingId === member.id ? (
            <AttendanceCorrectionForm
              employeeId={member.id}
              employeeName={member.fullName}
              onClose={() => setCorrectingId(null)}
            />
          ) : (
            <button onClick={() => setCorrectingId(member.id)}>Correct attendance</button>
          )
        }
      />
    </LocaleProvider>
  );
}

beforeAll(async () => {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
  });
  setAccessToken(res.accessToken);
}, 15000);

afterAll(() => {
  setAccessToken(null);
});

describe("Manager team view + attendance correction — real backend integration", () => {
  it("the real department-scoped team list includes the in-department employee, never the out-of-scope one", async () => {
    render(<TeamPageForTest />);

    expect(await screen.findByText(IN_SCOPE_NAME, {}, { timeout: 10000 })).toBeInTheDocument();
    // Structurally impossible to reach via this UI, not just "didn't
    // happen to render" — the out-of-scope employee is never IN the
    // array GET /employees returned in the first place.
    expect(screen.queryByText(OUT_OF_SCOPE_NAME)).not.toBeInTheDocument();
  }, 15000);

  it("submits a real attendance correction for the in-department employee, recorded as admin_override", async () => {
    render(<TeamPageForTest />);
    const inScopeName = await screen.findByText(IN_SCOPE_NAME, {}, { timeout: 10000 });
    const row = inScopeName.closest("li");
    if (!row) throw new Error("Expected the employee name to be inside a team row");

    await userEvent.click(within(row).getByRole("button", { name: "Correct attendance" }));
    await userEvent.type(within(row).getByLabelText("Clock in"), pastDateTimeLocalString(2));
    await userEvent.type(within(row).getByLabelText("Note"), "Real integration test correction");
    await userEvent.click(within(row).getByRole("button", { name: "Save correction" }));

    expect(
      await within(row).findByText(/Correction saved — recorded as an admin override/, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(within(row).getByText(/admin_override/)).toBeInTheDocument();
  }, 20000);

  it("a direct API attempt to correct the OUT-OF-SCOPE employee's REAL attendance is rejected server-side (404), matching step 6's e2e pattern — not just hidden by the UI", async () => {
    // Look up the real id (as admin — the manager's own session can't
    // discover it at all, by design), then switch back to the manager's
    // session to attempt the actual override with that real, valid id —
    // proving the rejection is genuinely scope-based, not just "unknown
    // id would 404 anyway".
    const outOfScopeEmployeeId = await fetchOutOfScopeEmployeeId();

    const managerLogin = await apiFetch<LoginOkResponse>("/auth/login", {
      method: "POST",
      body: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
    });
    setAccessToken(managerLogin.accessToken);

    const attempt = apiFetch("/attendance/override", {
      method: "POST",
      body: {
        employeeId: outOfScopeEmployeeId,
        clockIn: new Date().toISOString(),
        note: "attempted cross-department override",
      },
    });
    await expect(attempt).rejects.toMatchObject({ status: 404 });
  }, 20000);
});
