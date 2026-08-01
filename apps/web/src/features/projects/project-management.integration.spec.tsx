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
import { afterAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { CreateProjectForm } from "./CreateProjectForm";
import { ProjectDetail } from "./ProjectDetail";
import type { ProjectDto } from "./projects-api";

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MANAGER_EMAIL = "frontend-e2e-manager@hrms.test";
const MANAGER_PASSWORD = "Frontend-E2E-Manager-Pass-1";
const IN_SCOPE_EMPLOYEE_NAME = "Frontend E2E Employee";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
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

function renderDetail(projectId: string, props: { canManage?: boolean; canArchive?: boolean } = {}) {
  return render(
    <LocaleProvider initialLocale="en">
      <ProjectDetail projectId={projectId} {...props} />
    </LocaleProvider>,
  );
}

describe("Project create/edit/archive + member management — real backend integration", () => {
  let createdProjectId: string;
  const runId = Date.now().toString(36);
  const projectName = `Frontend E2E Managed Project ${runId}`;

  afterAll(() => {
    setAccessToken(null);
  });

  it("company_admin creates a real project through the actual form", async () => {
    setAccessToken(await loginAsAdmin());

    let created: ProjectDto | undefined;
    render(
      <LocaleProvider initialLocale="en">
        <CreateProjectForm
          onCreated={(project) => {
            created = project;
          }}
          onCancel={() => {}}
        />
      </LocaleProvider>,
    );

    await userEvent.type(screen.getByLabelText("Name"), projectName);
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(created).toBeDefined(), { timeout: 10000 });
    expect(created!.name).toBe(projectName);
    createdProjectId = created!.id;
  }, 15000);

  it("company_admin edits the real project through the actual detail view", async () => {
    setAccessToken(await loginAsAdmin());
    renderDetail(createdProjectId, { canManage: true, canArchive: true });

    await waitFor(() => expect(screen.getByText(projectName)).toBeInTheDocument(), { timeout: 10000 });
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const nameField = await screen.findByLabelText("Name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, `${projectName} (renamed)`);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(
      () => expect(screen.getByText(`${projectName} (renamed)`)).toBeInTheDocument(),
      { timeout: 10000 },
    );
  }, 15000);

  it("company_admin adds a real member through the actual UI", async () => {
    setAccessToken(await loginAsAdmin());
    renderDetail(createdProjectId, { canManage: true, canArchive: true });

    await waitFor(() => expect(screen.getByText("No members yet.")).toBeInTheDocument(), {
      timeout: 10000,
    });

    // The employee picker populates from a separate, parallel fetchTeam()
    // call — wait for the real option to actually exist before selecting
    // it, rather than racing the picker's own load.
    await waitFor(
      () => expect(screen.getByRole("option", { name: IN_SCOPE_EMPLOYEE_NAME })).toBeInTheDocument(),
      { timeout: 10000 },
    );
    await userEvent.selectOptions(screen.getByLabelText("Add a member"), IN_SCOPE_EMPLOYEE_NAME);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    // waitFor + getByText (re-queries the live DOM on every poll), not
    // findByText's resolve-once-then-assert shape — the add triggers two
    // overlapping re-renders (the picker resetting locally, the parent
    // reloading the project), and a resolved-but-since-detached node from
    // the first is a real, if narrow, race with the latter pattern.
    await waitFor(() => expect(screen.getByText(IN_SCOPE_EMPLOYEE_NAME)).toBeInTheDocument(), {
      timeout: 10000,
    });
  }, 20000);

  // Deliberately AFTER the add-member test, not before it: the manager's
  // own_department scope for a Project requires a REAL member from their
  // managed department to already be present (see ProjectsService.
  // scopeWhere, DECISIONS.md step 3) — an empty project is invisible to
  // any own_department-scoped manager, even one who could otherwise edit
  // it once it has the right member. Running this before the member is
  // added would 404 for a genuinely correct backend reason, not a bug.
  it("manager (own_department, default edit grant) can now see and edit the project — visible because it has a real member from their managed department — but sees no archive control", async () => {
    setAccessToken(await loginAsManager());
    renderDetail(createdProjectId, { canManage: true, canArchive: false });

    await waitFor(
      () => expect(screen.getByText(`${projectName} (renamed)`)).toBeInTheDocument(),
      { timeout: 10000 },
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  }, 15000);

  it("a plain read-only render (no canManage/canArchive) shows no management controls at all", async () => {
    setAccessToken(await loginAsAdmin());
    renderDetail(createdProjectId);

    await waitFor(
      () => expect(screen.getByText(`${projectName} (renamed)`)).toBeInTheDocument(),
      { timeout: 10000 },
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  }, 15000);

  it("company_admin removes the real member through the actual UI", async () => {
    setAccessToken(await loginAsAdmin());
    renderDetail(createdProjectId, { canManage: true, canArchive: true });

    const memberRow = await screen.findByText(IN_SCOPE_EMPLOYEE_NAME, {}, { timeout: 10000 });
    const row = memberRow.closest("li");
    if (!row) throw new Error("Expected the member name to be inside a list item");
    await userEvent.click(within(row).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(screen.getByText("No members yet.")).toBeInTheDocument(), {
      timeout: 10000,
    });
  }, 15000);

  it("company_admin archives the project through the actual confirm flow — status becomes Cancelled, the archive control disappears (soft, not hard delete)", async () => {
    setAccessToken(await loginAsAdmin());
    renderDetail(createdProjectId, { canManage: true, canArchive: true });

    await waitFor(
      () => expect(screen.getByText(`${projectName} (renamed)`)).toBeInTheDocument(),
      { timeout: 10000 },
    );
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, archive" }));

    await waitFor(() => expect(screen.getByText("Cancelled")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();

    // Still readable afterward — archiving is not a hard delete.
    expect(screen.getByText(`${projectName} (renamed)`)).toBeInTheDocument();
  }, 15000);
});
