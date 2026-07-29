import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";
import ChangePasswordPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);
const replace = vi.fn();

function renderPage() {
  return render(
    <LocaleProvider initialLocale="en">
      <AuthProvider>
        <ChangePasswordPage />
      </AuthProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  replace.mockClear();
  mockedApiFetch.mockReset();
});

describe("ChangePasswordPage", () => {
  it("renders the form once a session with mustChangePassword:true is established, no redirect", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") return { accessToken: "tok", mustChangePassword: true };
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "company_admin" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderPage();

    expect(await screen.findByText("Update your password")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no session at all", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderPage();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("redirects to / when the session doesn't actually need a password change (nothing to force)", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") return { accessToken: "tok", mustChangePassword: false };
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "employee" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderPage();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("a successful submit clears the flag and redirects home", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") return { accessToken: "tok", mustChangePassword: true };
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "company_admin" };
      if (path === "/auth/password/change") return { message: "ok" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderPage();
    expect(await screen.findByText("Update your password")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Current password"), "old-password");
    await userEvent.type(screen.getByLabelText("New password"), "new-password-123");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("validates the new password's minimum length client-side, without calling the API", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") return { accessToken: "tok", mustChangePassword: true };
      if (path === "/auth/me") return { userId: "u1", companyId: "c1", role: "company_admin" };
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderPage();
    expect(await screen.findByText("Update your password")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Current password"), "old-password");
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith("/auth/password/change", expect.anything());
  });
});
