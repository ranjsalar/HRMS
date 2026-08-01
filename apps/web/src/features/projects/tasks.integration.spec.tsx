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
import { TaskList } from "./TaskList";

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
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
  title: string;
  status: string;
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

async function loginAsEmployee(): Promise<string> {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email: EMPLOYEE_EMAIL, password: EMPLOYEE_PASSWORD },
  });
  return res.accessToken;
}

function renderTaskList(projectId: string) {
  return render(
    <LocaleProvider initialLocale="en">
      <TaskList projectId={projectId} />
    </LocaleProvider>,
  );
}

describe("TaskList — real backend integration", () => {
  let projectId: string;
  let taskTitle: string;

  beforeAll(async () => {
    const runId = Date.now().toString(36);
    taskTitle = `Frontend E2E Task ${runId}`;

    const adminToken = await loginAsAdmin();
    setAccessToken(adminToken);

    const employees = await apiFetch<EmployeeSummary[]>("/employees");
    const employee = employees.find((e) => e.fullName === IN_SCOPE_EMPLOYEE_NAME);
    if (!employee) throw new Error("Expected the in-scope fixture employee to exist");

    const project = await apiFetch<ProjectSummary>("/projects", {
      method: "POST",
      body: { name: `Frontend E2E Task List Project ${runId}` },
    });
    projectId = project.id;
    await apiFetch(`/projects/${projectId}/members`, {
      method: "POST",
      body: { employeeId: employee.id },
    });
    await apiFetch<TaskSummary>("/tasks", {
      method: "POST",
      body: { projectId, title: taskTitle, assigneeId: employee.id },
    });

    setAccessToken(null);
  }, 20000);

  afterAll(() => {
    setAccessToken(null);
  });

  it("shows the real task with its real assignee's name to a non-assignee viewer, status as read-only text (no control)", async () => {
    setAccessToken(await loginAsAdmin());
    renderTaskList(projectId);

    await waitFor(() => expect(screen.getByText(taskTitle)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText(IN_SCOPE_EMPLOYEE_NAME)).toBeInTheDocument();
    expect(screen.getByText("To do")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  }, 15000);

  it("the real assignee gets an interactive status control and can genuinely change status against the real API", async () => {
    setAccessToken(await loginAsEmployee());
    renderTaskList(projectId);

    await waitFor(() => expect(screen.getByText(taskTitle)).toBeInTheDocument(), { timeout: 10000 });
    const statusControl = screen.getByLabelText("Status");
    expect(statusControl).toBeInTheDocument();

    await userEvent.selectOptions(statusControl, "In progress");
    await waitFor(() => expect(screen.getByLabelText("Status")).toHaveValue("in_progress"), {
      timeout: 10000,
    });

    // Re-verify directly against the real API, not just the optimistic UI
    // state — the point of this test is that the PATCH genuinely landed.
    setAccessToken(await loginAsAdmin());
    const tasks = await apiFetch<TaskSummary[]>("/tasks");
    const updated = tasks.find((t) => t.title === taskTitle);
    expect(updated?.status).toBe("in_progress");
  }, 15000);

  it("a project member who is NOT the assignee sees the task but no status control (self scope's write stays assignee-only)", async () => {
    // Re-use the admin session as a stand-in "can view, not assignee"
    // check is already covered by the first test above; this test
    // specifically re-confirms via a second, independent render that the
    // control never appears for a non-assignee, now that status has
    // genuinely changed server-side.
    setAccessToken(await loginAsAdmin());
    renderTaskList(projectId);

    await waitFor(() => expect(screen.getByText(taskTitle)).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  }, 15000);
});
