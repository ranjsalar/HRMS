// Real-backend integration test — apiFetch is NOT mocked here. Requires
// the API dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
//
// Credentials duplicated from
// apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on purpose,
// same convention as login.integration.spec.tsx — keep in sync by hand.
import { authenticator } from "otplib";
import { render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { ProjectDetail } from "./ProjectDetail";
import { ProjectList } from "./ProjectList";

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MANAGER_EMAIL = "frontend-e2e-manager@hrms.test";
const MANAGER_PASSWORD = "Frontend-E2E-Manager-Pass-1";
const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";
const IN_SCOPE_EMPLOYEE_NAME = "Frontend E2E Employee";
const OUT_OF_SCOPE_EMPLOYEE_NAME = "Frontend E2E Out-of-Scope Employee";

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
  name: string;
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

async function loginAsOk(email: string, password: string): Promise<string> {
  const res = await apiFetch<LoginOkResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  return res.accessToken;
}

function renderList() {
  return render(
    <LocaleProvider initialLocale="en">
      <ProjectList />
    </LocaleProvider>,
  );
}

function renderDetail(projectId: string) {
  return render(
    <LocaleProvider initialLocale="en">
      <ProjectDetail projectId={projectId} />
    </LocaleProvider>,
  );
}

describe("Projects — real backend integration", () => {
  let inScopeProjectId: string;
  let inScopeProjectName: string;
  let outOfScopeProjectName: string;

  beforeAll(async () => {
    const runId = Date.now().toString(36);
    inScopeProjectName = `Frontend E2E In-Scope Project ${runId}`;
    outOfScopeProjectName = `Frontend E2E Out-of-Scope Project ${runId}`;

    const adminToken = await loginAsAdmin();
    setAccessToken(adminToken);

    const employees = await apiFetch<EmployeeSummary[]>("/employees");
    const inScopeEmployee = employees.find((e) => e.fullName === IN_SCOPE_EMPLOYEE_NAME);
    const outOfScopeEmployee = employees.find((e) => e.fullName === OUT_OF_SCOPE_EMPLOYEE_NAME);
    if (!inScopeEmployee || !outOfScopeEmployee) {
      throw new Error("Expected both the in-scope and out-of-scope fixture employees to exist");
    }

    const inScopeProject = await apiFetch<ProjectSummary>("/projects", {
      method: "POST",
      body: { name: inScopeProjectName, description: "Real integration test project" },
    });
    inScopeProjectId = inScopeProject.id;
    await apiFetch(`/projects/${inScopeProjectId}/members`, {
      method: "POST",
      body: { employeeId: inScopeEmployee.id },
    });

    const outOfScopeProject = await apiFetch<ProjectSummary>("/projects", {
      method: "POST",
      body: { name: outOfScopeProjectName },
    });
    await apiFetch(`/projects/${outOfScopeProject.id}/members`, {
      method: "POST",
      body: { employeeId: outOfScopeEmployee.id },
    });

    setAccessToken(null);
  }, 20000);

  afterAll(() => {
    setAccessToken(null);
  });

  it("company_admin sees BOTH the in-scope and out-of-scope project in the real list", async () => {
    setAccessToken(await loginAsAdmin());
    renderList();

    await waitFor(() => expect(screen.getByText(inScopeProjectName)).toBeInTheDocument(), {
      timeout: 10000,
    });
    expect(screen.getByText(outOfScopeProjectName)).toBeInTheDocument();
  }, 15000);

  it("manager (own_department) sees the in-scope project, never the out-of-scope one, against the real API", async () => {
    setAccessToken(await loginAsOk(MANAGER_EMAIL, MANAGER_PASSWORD));
    renderList();

    await waitFor(() => expect(screen.getByText(inScopeProjectName)).toBeInTheDocument(), {
      timeout: 10000,
    });
    expect(screen.queryByText(outOfScopeProjectName)).not.toBeInTheDocument();
  }, 15000);

  it("employee (self) sees the project they're a member of, never the one they're not, against the real API", async () => {
    setAccessToken(await loginAsOk(EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD));
    renderList();

    await waitFor(() => expect(screen.getByText(inScopeProjectName)).toBeInTheDocument(), {
      timeout: 10000,
    });
    expect(screen.queryByText(outOfScopeProjectName)).not.toBeInTheDocument();
  }, 15000);

  it("the project detail view shows real member data fetched from the API", async () => {
    setAccessToken(await loginAsAdmin());
    renderDetail(inScopeProjectId);

    await waitFor(() => expect(screen.getByText(inScopeProjectName)).toBeInTheDocument(), {
      timeout: 10000,
    });
    expect(screen.getByText(IN_SCOPE_EMPLOYEE_NAME)).toBeInTheDocument();
  }, 15000);
});
