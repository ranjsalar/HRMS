// Real-backend integration test — apiFetch is NOT mocked here. Requires
// the API dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
//
// Credentials duplicated from
// apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on purpose,
// same convention as login.integration.spec.tsx — keep in sync by hand.
import { authenticator } from "otplib";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { TaskList } from "./TaskList";

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
  title: string;
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

function renderList(projectId: string, canManage = false) {
  return render(
    <LocaleProvider initialLocale="en">
      <TaskList projectId={projectId} canManage={canManage} />
    </LocaleProvider>,
  );
}

describe("Task create/edit/delete — real backend integration", () => {
  let projectId: string;
  const runId = Date.now().toString(36);
  const taskTitle = `Frontend E2E Managed Task ${runId}`;

  beforeAll(async () => {
    setAccessToken(await loginAsAdmin());

    const employees = await apiFetch<EmployeeSummary[]>("/employees");
    const employee = employees.find((e) => e.fullName === IN_SCOPE_EMPLOYEE_NAME);
    if (!employee) throw new Error("Expected the in-scope fixture employee to exist");

    const project = await apiFetch<ProjectSummary>("/projects", {
      method: "POST",
      body: { name: `Frontend E2E Task Management Project ${runId}` },
    });
    projectId = project.id;
    // A real member from the manager's managed department — same
    // precondition step 6.2 established: own_department visibility
    // requires a real member already present.
    await apiFetch(`/projects/${projectId}/members`, {
      method: "POST",
      body: { employeeId: employee.id },
    });

    setAccessToken(null);
  }, 20000);

  afterAll(() => {
    setAccessToken(null);
  });

  it("company_admin creates a real task through the actual form", async () => {
    setAccessToken(await loginAsAdmin());
    renderList(projectId, true);

    await waitFor(() => expect(screen.getByText("No tasks yet.")).toBeInTheDocument(), {
      timeout: 10000,
    });
    await userEvent.click(screen.getByRole("button", { name: "New task" }));
    await userEvent.type(screen.getByLabelText("Title"), taskTitle);
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(screen.getByText(taskTitle)).toBeInTheDocument(), { timeout: 10000 });
  }, 15000);

  it("company_admin edits and reassigns the real task through the actual form", async () => {
    setAccessToken(await loginAsAdmin());
    renderList(projectId, true);

    const row = (await screen.findByText(taskTitle, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the task title to be inside a list item");
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));

    await userEvent.selectOptions(await screen.findByLabelText("Assignee"), IN_SCOPE_EMPLOYEE_NAME);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText(IN_SCOPE_EMPLOYEE_NAME)).toBeInTheDocument(), {
      timeout: 10000,
    });
  }, 15000);

  it("manager (own_department, default edit grant) sees the same management controls on the now-visible task", async () => {
    setAccessToken(await loginAsManager());
    renderList(projectId, true);

    const row = (await screen.findByText(taskTitle, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the task title to be inside a list item");
    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  }, 15000);

  it("the assignee (canManage=false) sees their own interactive status control but no edit/delete/new-task management controls", async () => {
    setAccessToken(await loginAsEmployee());
    renderList(projectId, false);

    const row = (await screen.findByText(taskTitle, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the task title to be inside a list item");
    expect(within(row).getByLabelText("Status")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New task" })).not.toBeInTheDocument();
  }, 15000);

  it("company_admin deletes the task through the actual confirm flow — a real hard delete, gone from a fresh fetch", async () => {
    setAccessToken(await loginAsAdmin());
    renderList(projectId, true);

    const row = (await screen.findByText(taskTitle, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the task title to be inside a list item");
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    await waitFor(() => expect(screen.queryByText(taskTitle)).not.toBeInTheDocument(), {
      timeout: 10000,
    });

    const tasks = await apiFetch<TaskSummary[]>("/tasks");
    expect(tasks.some((t) => t.title === taskTitle)).toBe(false);
  }, 15000);
});
