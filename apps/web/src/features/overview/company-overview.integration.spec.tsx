// Real-backend integration test — apiFetch is NOT mocked. Builds a
// brand-new, fully isolated company (via the real Super Admin dashboard
// endpoints, same as superadmin.integration.spec.tsx) so the counts this
// test asserts on are deterministic — the shared frontend-auth-fixtures
// company accumulates state across every test run ever executed against
// it (a known, accepted limitation — see DECISIONS.md), which would make
// exact-count assertions flaky if run against it instead.
import { render, screen, within } from "@testing-library/react";
import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiFetch, setAccessToken } from "@/lib/api-client";
import { LocaleProvider } from "@/lib/locale-context";
import { CompanyOverview } from "./CompanyOverview";

const SUPERADMIN_EMAIL = "frontend-e2e-superadmin@hrms.test";
const SUPERADMIN_PASSWORD = "Frontend-E2E-Superadmin-Pass-1";
const SUPERADMIN_TOTP_SECRET = "KRSXG5CTMVRXEZLUEBSXG5CTMVRXEZLU";

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
  mustChangePassword?: boolean;
}
interface LoginPendingResponse {
  status: "2fa_required" | "2fa_enrollment_required";
  pendingToken: string;
}
interface EnrollResponse {
  secret: string;
}
interface CreateCompanyResponse {
  company: { id: string; name: string };
  admin: { email: string };
  temporaryPassword: string;
}
interface CreateEmployeeResponse {
  temporaryPassword?: string;
}

/** For employee/manager, whose roles never require 2FA (TwoFactorService.roleRequiresTwoFactor) — always resolves directly to "ok", first login or not. */
async function login(email: string, password: string): Promise<string> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (res.status === "ok") return res.accessToken;
  throw new Error(`Unexpected login status "${res.status}" for ${email}`);
}

/** company_admin's genuinely first login: temp password, no 2FA enrolled yet — mandatory enrollment. Returns the enrolled secret too, since company_admin (unlike employee/manager) requires 2FA on EVERY subsequent login, not just this first one. */
async function loginFirstTimeAdmin(
  email: string,
  password: string,
): Promise<{ accessToken: string; totpSecret: string }> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (res.status !== "2fa_enrollment_required") {
    throw new Error(`Expected 2fa_enrollment_required for a fresh company_admin, got "${res.status}"`);
  }
  const enroll = await apiFetch<EnrollResponse>("/auth/2fa/enroll", {
    method: "POST",
    body: { pendingToken: res.pendingToken },
  });
  const enable = await apiFetch<LoginOkResponse>("/auth/2fa/enable", {
    method: "POST",
    body: { pendingToken: res.pendingToken, code: authenticator.generate(enroll.secret) },
  });
  return { accessToken: enable.accessToken, totpSecret: enroll.secret };
}

/** company_admin's every login AFTER the first: real password, real 2FA verify against the already-enrolled secret. */
async function loginAdmin(email: string, password: string, totpSecret: string): Promise<string> {
  const res = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
  if (res.status !== "2fa_required") {
    throw new Error(`Expected 2fa_required for an already-enrolled company_admin, got "${res.status}"`);
  }
  const verify = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
    method: "POST",
    body: { pendingToken: res.pendingToken, code: authenticator.generate(totpSecret) },
  });
  return verify.accessToken;
}

async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  setAccessToken(token);
  await apiFetch("/auth/password/change", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

describe("CompanyOverview — real backend integration", () => {
  const runId = Date.now().toString(36);
  const companyName = `Overview Integration Co ${runId}`;
  const adminEmail = `overview-admin-${runId}@e2e.test`;
  const employee1Email = `overview-emp1-${runId}@e2e.test`;
  const employee2Email = `overview-emp2-${runId}@e2e.test`;
  const adminFinalPassword = "overview-admin-real-password-999";
  const emp1FinalPassword = "overview-emp1-real-password-999";
  const emp2FinalPassword = "overview-emp2-real-password-999";

  let adminToken: string;

  beforeAll(async () => {
    // 1. Real superadmin session -> create a brand-new, isolated company + admin.
    const saLogin = await apiFetch<LoginOkResponse | LoginPendingResponse>("/auth/login", {
      method: "POST",
      body: { email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD },
    });
    if (saLogin.status !== "2fa_required") throw new Error("Expected superadmin fixture to require 2FA");
    const saVerify = await apiFetch<LoginOkResponse>("/auth/2fa/verify", {
      method: "POST",
      body: { pendingToken: saLogin.pendingToken, code: authenticator.generate(SUPERADMIN_TOTP_SECRET) },
    });
    setAccessToken(saVerify.accessToken);

    const created = await apiFetch<CreateCompanyResponse>("/superadmin/companies", {
      method: "POST",
      body: { name: companyName, city: "Erbil", adminName: "Overview Admin", adminEmail },
    });

    // 2. Admin's real first login: mandatory 2FA enrollment, then mandatory password change.
    const adminEnrollment = await loginFirstTimeAdmin(adminEmail, created.temporaryPassword);
    await changePassword(adminEnrollment.accessToken, created.temporaryPassword, adminFinalPassword);
    adminToken = await loginAdmin(adminEmail, adminFinalPassword, adminEnrollment.totpSecret);
    setAccessToken(adminToken);

    // 3. A real LeaveType — nothing exists for a fresh company by default.
    const leaveType = await apiFetch<{ id: string }>("/leave-types", {
      method: "POST",
      body: { name: "Annual Leave", daysPerYear: 20 },
    });

    // 4. Two real employees, each with a login.
    const emp1 = await apiFetch<CreateEmployeeResponse>("/employees", {
      method: "POST",
      body: {
        fullName: "Overview Employee One",
        nationalId: `OVERVIEW-1-${runId}`,
        jobTitle: "Engineer",
        hireDate: "2024-01-01",
        salaryBase: 500000,
        email: employee1Email,
      },
    });
    const emp2 = await apiFetch<CreateEmployeeResponse>("/employees", {
      method: "POST",
      body: {
        fullName: "Overview Employee Two",
        nationalId: `OVERVIEW-2-${runId}`,
        jobTitle: "Designer",
        hireDate: "2024-01-01",
        salaryBase: 500000,
        email: employee2Email,
      },
    });

    // 5. Employee 1: real first login, real password change, real clock-in — stays clocked in (no clock-out).
    const emp1Provisional = await login(employee1Email, emp1.temporaryPassword!);
    await changePassword(emp1Provisional, emp1.temporaryPassword!, emp1FinalPassword);
    const emp1Token = await login(employee1Email, emp1FinalPassword);
    setAccessToken(emp1Token);
    await apiFetch("/attendance/clock-in", { method: "POST", body: {} });

    // 6. Employee 2: real first login, real password change, submits a real pending leave request — never clocks in today.
    const emp2Provisional = await login(employee2Email, emp2.temporaryPassword!);
    await changePassword(emp2Provisional, emp2.temporaryPassword!, emp2FinalPassword);
    const emp2Token = await login(employee2Email, emp2FinalPassword);
    setAccessToken(emp2Token);
    await apiFetch("/leave-requests", {
      method: "POST",
      body: { leaveTypeId: leaveType.id, startDate: "2026-09-10", endDate: "2026-09-10" },
    });

    // Back to the admin session for the actual test.
    setAccessToken(adminToken);
  }, 60000);

  afterAll(() => {
    setAccessToken(null);
  });

  it("shows the real total employee count, real pending-leave count, and real today's-attendance status for each employee", async () => {
    setAccessToken(adminToken);
    render(
      <LocaleProvider initialLocale="en">
        <CompanyOverview />
      </LocaleProvider>,
    );

    const totalTile = (
      await screen.findByText("Total employees", {}, { timeout: 10000 })
    ).closest("div")!;
    expect(within(totalTile).getByText("2")).toBeInTheDocument(); // exactly the 2 employees created above, nothing else in this isolated company

    const pendingTile = screen.getByText("Pending leave requests").closest("div")!;
    expect(within(pendingTile).getByText("1")).toBeInTheDocument();

    const emp1Row = (await screen.findByText(/Overview Employee One/, {}, { timeout: 10000 })).closest("li")!;
    expect(within(emp1Row).getByText("Clocked in")).toBeInTheDocument();
    expect(within(emp1Row).getByText(/In: /)).toBeInTheDocument();

    const emp2Row = screen.getByText(/Overview Employee Two/).closest("li")!;
    expect(within(emp2Row).getByText("Not clocked in")).toBeInTheDocument();
  }, 30000);
});
