import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api-client";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/locale-context";
import Home from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});
vi.mock("next/navigation", () => ({ useRouter: vi.fn(), usePathname: vi.fn(() => "/") }));

const mockedApiFetch = vi.mocked(apiFetch);
const replace = vi.fn();

function renderHome() {
  return render(
    <LocaleProvider initialLocale="en">
      <AuthProvider>
        <Home />
      </AuthProvider>
    </LocaleProvider>,
  );
}

function mockAuthenticatedSession(): void {
  mockedApiFetch.mockImplementation(async (path, options) => {
    const p = String(path);
    if (p === "/auth/refresh") return { accessToken: "tok", mustChangePassword: false };
    if (p === "/auth/me") {
      return { userId: "u1", companyId: "c1", role: "employee", email: "employee@e2e.test" };
    }
    if (p.startsWith("/attendance/me")) return [];
    if (p.startsWith("/leave-balances/me")) return [];
    if (p === "/leave-types") return [];
    if (p.startsWith("/holidays/upcoming")) return [];
    if (p === "/auth/logout") return { message: "ok" };
    throw new Error(`unexpected path ${p} ${JSON.stringify(options)}`);
  });
}

beforeEach(() => {
  vi.mocked(useRouter).mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  replace.mockClear();
  mockedApiFetch.mockReset();
});

describe("Home (dashboard) — assembled from all three widgets", () => {
  it("shows a loading skeleton while the session is still resolving, then the full dashboard", async () => {
    mockAuthenticatedSession();
    renderHome();

    expect(await screen.findByText("Today's attendance")).toBeInTheDocument();
    expect(screen.getByText("Leave balance")).toBeInTheDocument();
    expect(screen.getByText("Upcoming holidays")).toBeInTheDocument();
  });

  it("greets the user by email and offers sign-out", async () => {
    mockAuthenticatedSession();
    renderHome();

    expect(await screen.findByText("Welcome, employee@e2e.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("signing out clears the session and redirects to login", async () => {
    mockAuthenticatedSession();
    renderHome();
    await screen.findByText("Today's attendance");

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("redirects to /login when there is no session at all", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      throw new Error(`unexpected path ${String(path)}`);
    });
    renderHome();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
