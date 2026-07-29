// Real-backend integration test — apiFetch is NOT mocked here, unlike
// page.spec.tsx. Requires the API dev server running
// (`pnpm --filter @hrms/api dev`) with the fixtures from
// `pnpm --filter @hrms/api db:seed-frontend-auth-fixtures` applied.
//
// Credentials below are duplicated from
// apps/api/src/database/seeds/seed-frontend-auth-fixtures.ts on purpose
// (not imported — see that file's comment) — keep them in sync by hand if
// either changes.
import { authenticator } from "otplib";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const ADMIN_EMAIL = "frontend-e2e-admin@hrms.test";
const ADMIN_PASSWORD = "Frontend-E2E-Admin-Pass-1";
const ADMIN_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMPLOYEE_EMAIL = "frontend-e2e-employee@hrms.test";
const EMPLOYEE_PASSWORD = "Frontend-E2E-Employee-Pass-1";

const replace = vi.fn();

function renderLoginPage() {
  return render(
    <LocaleProvider initialLocale="en">
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </LocaleProvider>,
  );
}

async function waitForCredentialsForm() {
  return waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument());
}

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  replace.mockClear();
});

describe("LoginPage — real backend integration", () => {
  it("a plain employee (no 2FA) logs in immediately against the real API", async () => {
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), EMPLOYEE_EMAIL);
    await userEvent.type(screen.getByLabelText("Password"), EMPLOYEE_PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 10000 });
  }, 15000);

  it("a company_admin (2FA-enrolled) logs in via a REAL, live-generated TOTP code verified by the real backend", async () => {
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), ADMIN_EMAIL);
    await userEvent.type(screen.getByLabelText("Password"), ADMIN_PASSWORD);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Two-factor verification", {}, { timeout: 10000 })).toBeInTheDocument();

    const liveCode = authenticator.generate(ADMIN_TOTP_SECRET);
    await userEvent.type(screen.getByLabelText("Verification code"), liveCode);
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), { timeout: 10000 });
  }, 20000);

  it("wrong credentials are rejected by the real AuthService with the translated message, not a raw error", async () => {
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), EMPLOYEE_EMAIL);
    await userEvent.type(screen.getByLabelText("Password"), "definitely-the-wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText("Invalid email or password.", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith("/");
  }, 15000);
});
