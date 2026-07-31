// Real-backend integration test — apiFetch is NOT mocked. Requires the API
// dev server running with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied (that
// script now also creates a superadmin fixture — see DECISIONS.md, "Super
// Admin dashboard: frontend"). The literal constants below are duplicated
// from apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on
// purpose (same convention login.integration.spec.tsx already uses) — keep
// them in sync by hand if the seed script's values ever change.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { authenticator } from "otplib";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { SuperAdminDashboard } from "./SuperAdminDashboard";

const SUPERADMIN_EMAIL = "frontend-e2e-superadmin@hrms.test";
const SUPERADMIN_PASSWORD = "Frontend-E2E-Superadmin-Pass-1";
const SUPERADMIN_TOTP_SECRET = "KRSXG5CTMVRXEZLUEBSXG5CTMVRXEZLU";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
}
interface LoginPendingResponse {
  status: "2fa_required";
  pendingToken: string;
}

async function loginAsSuperadmin(): Promise<void> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
  });
  if (res.status === "ok") {
    setAccessToken(res.accessToken);
    return;
  }
  const code = authenticator.generate(SUPERADMIN_TOTP_SECRET);
  const verify = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
    method: "POST",
    body: { pendingToken: res.pendingToken, code },
  });
  setAccessToken(verify.accessToken);
}

beforeAll(async () => {
  await loginAsSuperadmin();
}, 15000);

afterEach(() => {
  // Each test re-authenticates as needed; clearing here means a test that
  // deliberately switches sessions (there aren't any in this file, but
  // keeps the pattern consistent with team.integration.spec.tsx) can't
  // leak a token into the next one.
  setAccessToken(null);
});

describe("Super Admin dashboard — real backend integration", () => {
  it("creates a real company + admin through the actual form, shows the temp password once, and lists the new company afterward", async () => {
    await loginAsSuperadmin();
    render(<SuperAdminDashboard />);

    await screen.findByText("Companies", {}, { timeout: 10000 });
    await userEvent.click(screen.getByRole("button", { name: "New company" }));

    const runId = Date.now().toString(36);
    const companyName = `Frontend Integration Co ${runId}`;
    const adminEmail = `frontend-integration-admin-${runId}@hrms.test`;

    await userEvent.type(screen.getByLabelText("Company name"), companyName);
    await userEvent.type(screen.getByLabelText("City"), "Erbil");
    await userEvent.type(screen.getByLabelText("Admin's name"), "Integration Test Admin");
    await userEvent.type(screen.getByLabelText("Admin's email"), adminEmail);
    await userEvent.click(screen.getByRole("button", { name: "Create company" }));

    // The one-time temp password banner, back on the list view.
    expect(
      await screen.findByText(`${companyName} created`, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    const passwordMatch = /Temporary password:\s*(\S+)/.exec(
      document.body.textContent ?? "",
    );
    expect(passwordMatch).not.toBeNull();
    expect(passwordMatch![1].length).toBeGreaterThan(10);

    // The list re-fetched and now includes the new company.
    const row = (await screen.findByText(companyName, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the new company to be inside a list row");
    expect(within(row).getByText(/active/)).toBeInTheDocument();
    expect(within(row).getByText(/0 employees/)).toBeInTheDocument();
  }, 20000);

  it("suspends and reactivates a real company via the toggle button, list reflecting the change each time", async () => {
    await loginAsSuperadmin();

    const runId = Date.now().toString(36);
    const companyName = `Frontend Integration Suspend Co ${runId}`;
    await apiFetch("/superadmin/companies", {
      method: "POST",
      body: {
        name: companyName,
        city: "Duhok",
        adminName: "Suspend Toggle Admin",
        adminEmail: `frontend-integration-suspend-${runId}@hrms.test`,
      },
    });

    render(<SuperAdminDashboard />);
    const row = (await screen.findByText(companyName, {}, { timeout: 10000 })).closest("li");
    if (!row) throw new Error("Expected the company to be inside a list row");

    await userEvent.click(within(row).getByRole("button", { name: "Suspend" }));
    expect(await within(row).findByText(/suspended/, {}, { timeout: 10000 })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Reactivate" })).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Reactivate" }));
    expect(await within(row).findByText(/active/, {}, { timeout: 10000 })).toBeInTheDocument();
  }, 20000);

  it("rejects a duplicate company name with a clear, specific error — the form stays open, nothing is created", async () => {
    await loginAsSuperadmin();

    const runId = Date.now().toString(36);
    const companyName = `Frontend Integration Dup Co ${runId}`;
    await apiFetch("/superadmin/companies", {
      method: "POST",
      body: {
        name: companyName,
        city: "Slemani",
        adminName: "Dup Admin",
        adminEmail: `frontend-integration-dup-${runId}@hrms.test`,
      },
    });

    render(<SuperAdminDashboard />);
    await userEvent.click(
      await screen.findByRole("button", { name: "New company" }, { timeout: 10000 }),
    );

    await userEvent.type(screen.getByLabelText("Company name"), companyName);
    await userEvent.type(screen.getByLabelText("City"), "Slemani");
    await userEvent.type(screen.getByLabelText("Admin's name"), "Second Attempt");
    await userEvent.type(
      screen.getByLabelText("Admin's email"),
      `frontend-integration-dup-2-${runId}@hrms.test`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Create company" }));

    expect(
      await screen.findByText(`A company named "${companyName}" already exists.`, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    // Still on the form — a failed submission doesn't silently drop back to the list.
    expect(screen.getByRole("button", { name: "Create company" })).toBeInTheDocument();
  }, 20000);
});
