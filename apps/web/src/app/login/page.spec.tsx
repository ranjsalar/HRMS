import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, UnauthorizedError } from "@/lib/api-client";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";
import LoginPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,fake") },
}));

const mockedApiFetch = vi.mocked(apiFetch);
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
  mockedApiFetch.mockReset();
});

describe("LoginPage — credentials step", () => {
  it("validates required fields client-side, without ever calling the API", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findAllByText("This field is required.")).toHaveLength(2);
    expect(mockedApiFetch).not.toHaveBeenCalledWith("/auth/login", expect.anything());
  });

  it("an immediate 'ok' login establishes a session and redirects home", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") {
        return { status: "ok", accessToken: "tok", mustChangePassword: false };
      }
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "employee" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), "employee@e2e.test");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("invalid credentials shows a translated message, never the raw backend string", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") {
        throw new UnauthorizedError("Invalid email or password", 401, null);
      }
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), "wrong@e2e.test");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid email or password.")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalledWith("/");
  });
});

describe("LoginPage — 2FA required (already-enrolled account)", () => {
  it("switches to the verify step, and a correct code completes login", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") return { status: "2fa_required", pendingToken: "pending-1" };
      if (path === "/auth/2fa/verify") return { accessToken: "tok", mustChangePassword: false };
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "company_admin" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), "admin@e2e.test");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Two-factor verification")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/auth/2fa/verify",
      expect.objectContaining({ body: { pendingToken: "pending-1", code: "123456" } }),
    );
  });

  it("rejects a malformed code client-side before calling the API", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") return { status: "2fa_required", pendingToken: "pending-1" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();
    await userEvent.type(screen.getByLabelText("Email"), "admin@e2e.test");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Two-factor verification")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Verification code"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Enter the 6-digit code.")).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith("/auth/2fa/verify", expect.anything());
  });

  it("an invalid code from the server shows a translated message", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") return { status: "2fa_required", pendingToken: "pending-1" };
      if (path === "/auth/2fa/verify") throw new UnauthorizedError("Invalid 2FA code", 401, null);
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();
    await userEvent.type(screen.getByLabelText("Email"), "admin@e2e.test");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Two-factor verification")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Verification code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText("Invalid or expired code.")).toBeInTheDocument();
  });
});

describe("LoginPage — 2FA enrollment required (first login for a role that mandates 2FA)", () => {
  it("shows the QR code and secret, and enabling with a code completes login", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") {
        return { status: "2fa_enrollment_required", pendingToken: "pending-2" };
      }
      if (path === "/auth/2fa/enroll") {
        return { secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/HRMS:admin?secret=JBSWY3DPEHPK3PXP" };
      }
      if (path === "/auth/2fa/enable") return { accessToken: "tok", mustChangePassword: false };
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "company_admin" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderLoginPage();
    await waitForCredentialsForm();

    await userEvent.type(screen.getByLabelText("Email"), "new-admin@e2e.test");
    await userEvent.type(screen.getByLabelText("Password"), "password123");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Set up two-factor authentication")).toBeInTheDocument();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    expect(await screen.findByAltText("")).toHaveAttribute("src", "data:image/png;base64,fake");

    await userEvent.type(screen.getByLabelText("Verification code"), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Enable and continue" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/auth/2fa/enable",
      expect.objectContaining({ body: { pendingToken: "pending-2", code: "654321" } }),
    );
  });
});
