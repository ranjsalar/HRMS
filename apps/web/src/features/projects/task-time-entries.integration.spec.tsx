// Real-backend integration test — apiFetch is NOT mocked here. Requires
// the API dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
//
// Credentials duplicated from
// apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on purpose,
// same convention as login.integration.spec.tsx — keep in sync by hand.
import { authenticator } from "otplib";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { TaskTimeEntries } from "./TaskTimeEntries";

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MANAGER_EMAIL = "frontend-e2e-manager@hrms.test";
const MANAGER_PASSWORD = "Frontend-E2E-Manager-Pass-1";
const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";
const IN_SCOPE_EMPLOYEE_NAME = "Frontend E2E Employee";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
}
interface EmployeeSummary {
  id: string;
  fullName: string;
}
interface ProjectSummary {
  id: string;
}
interface TaskSummary {
  id: string;
}

async function loginAsAdmin(): Promise<string> {
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

async function loginAsManager(): Promise<string> {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: MANAGER_EMAIL, password: MANAGER_PASSWORD },
  });
  return res.accessToken;
}

async function loginAsEmployee(): Promise<string> {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  return res.accessToken;
}

function renderEntries(taskId: string, isAssignee: boolean, showOwnDepartmentCaveat: boolean) {
  return render(
    <LocaleProvider initialLocale="en">
      <TaskTimeEntries
        taskId={taskId}
        isAssignee={isAssignee}
        showOwnDepartmentCaveat={showOwnDepartmentCaveat}
        team={[]}
      />
    </LocaleProvider>,
  );
}

describe("TaskTimeEntries — real backend integration", () => {
  let taskId: string;

  beforeAll(async () => {
    const runId = Date.now().toString(36);
    setAccessToken(await loginAsAdmin());

    const employees = await apiFetch<EmployeeSummary[]>("/employees");
    const employee = employees.find((e) => e.fullName === IN_SCOPE_EMPLOYEE_NAME);
    if (!employee) throw new Error("Expected the in-scope fixture employee to exist");

    const project = await apiFetch<ProjectSummary>("/projects", {
      method: "POST",
      body: { name: `Frontend E2E Time Entries Project ${runId}` },
    });
    await apiFetch(`/projects/${project.id}/members`, {
      method: "POST",
      body: { employeeId: employee.id },
    });
    const task = await apiFetch<TaskSummary>("/tasks", {
      method: "POST",
      body: { projectId: project.id, title: `Frontend E2E Time Entries Task ${runId}`, assigneeId: employee.id },
    });
    taskId = task.id;

    setAccessToken(null);
  }, 20000);

  afterAll(() => {
    setAccessToken(null);
  });

  it("the real assignee logs a real time entry through the actual form, and it appears in the real list", async () => {
    setAccessToken(await loginAsEmployee());
    renderEntries(taskId, true, false);

    await waitFor(() => expect(screen.getByText("No time logged yet.")).toBeInTheDocument(), {
      timeout: 10000,
    });

    await userEvent.type(screen.getByLabelText("Date"), "2026-07-20");
    await userEvent.type(screen.getByLabelText("Hours"), "2.5");
    await userEvent.type(screen.getByLabelText("Note (optional)"), "Investigated the real bug");
    await userEvent.click(screen.getByRole("button", { name: "Log time" }));

    await waitFor(() => expect(screen.getByText(/2\.5h/)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText(/Investigated the real bug/)).toBeInTheDocument();

    // Re-verify directly against the real API, not just the optimistic
    // UI state.
    setAccessToken(await loginAsAdmin());
    const entries = await apiFetch<{ hours: string; note: string | null }[]>(
      `/tasks/${taskId}/time-entries`,
    );
    expect(entries.some((e) => e.hours === "2.5" && e.note === "Investigated the real bug")).toBe(true);
  }, 20000);

  it("company_admin sees the real entry with no own_department caveat", async () => {
    setAccessToken(await loginAsAdmin());
    renderEntries(taskId, false, false);

    await waitFor(() => expect(screen.getByText(/2\.5h/)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/you may not see every hour logged here/i),
    ).not.toBeInTheDocument();
  }, 15000);

  it("manager sees the real entry (same department as the assignee) WITH the plain-language own_department caveat, and no log form (not the assignee)", async () => {
    setAccessToken(await loginAsManager());
    renderEntries(taskId, false, true);

    await waitFor(() => expect(screen.getByText(/2\.5h/)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByLabelText("Date")).not.toBeInTheDocument();
    expect(screen.getByText(/you may not see every hour logged here/i)).toBeInTheDocument();
  }, 15000);
});
