import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";
import { apiFetch } from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("AuthProvider — silent refresh on mount", () => {
  it("a valid refresh cookie establishes a session with no visible login step", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") {
        return { accessToken: "token-1", mustChangePassword: false };
      }
      if (path === "/auth/me") {
        return { userId: "u1", companyId: "c1", role: "employee" };
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.user).toEqual({ userId: "u1", companyId: "c1", role: "employee" });
    expect(result.current.mustChangePassword).toBe(false);
  });

  it("no valid refresh cookie leaves the user unauthenticated, without throwing an error to the UI", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") {
        throw new Error("401");
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.user).toBeNull();
  });

  it("a session with mustChangePassword:true is still 'authenticated' — routing, not this context, decides what that blocks", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") {
        return { accessToken: "token-1", mustChangePassword: true };
      }
      if (path === "/auth/me") {
        return { userId: "u1", companyId: "c1", role: "company_admin" };
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.mustChangePassword).toBe(true);
  });
});

describe("AuthProvider — login", () => {
  it("an immediate 'ok' login establishes a full session", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") {
        return { status: "ok", accessToken: "token-2", mustChangePassword: false };
      }
      if (path === "/auth/me") {
        return { userId: "u2", companyId: "c2", role: "manager" };
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      const res = await result.current.login("a@e2e.test", "password");
      expect(res.status).toBe("ok");
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.userId).toBe("u2");
  });

  it("a '2fa_required' login response does NOT establish a session — the caller still has to complete 2FA", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/login") {
        return { status: "2fa_required", pendingToken: "pending-1" };
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      const res = await result.current.login("a@e2e.test", "password");
      expect(res.status).toBe("2fa_required");
    });

    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });
});

describe("AuthProvider — establishSession (used by the 2FA verify/enroll screens)", () => {
  it("establishes a session from a token obtained outside login()", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") throw new Error("401");
      if (path === "/auth/me") {
        return { userId: "u3", companyId: "c3", role: "employee" };
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.establishSession("token-from-2fa", false);
    });

    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.userId).toBe("u3");
  });
});

describe("AuthProvider — logout", () => {
  it("clears the session even if the logout API call fails", async () => {
    mockedApiFetch.mockImplementation(async (path) => {
      if (path === "/auth/refresh") {
        return { accessToken: "token-1", mustChangePassword: false };
      }
      if (path === "/auth/me") {
        return { userId: "u1", companyId: "c1", role: "employee" };
      }
      if (path === "/auth/logout") {
        throw new Error("network error");
      }
      throw new Error(`unexpected path ${String(path)}`);
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      await result.current.logout(); // does NOT reject — local session clears regardless
    });
    consoleErrorSpy.mockRestore();

    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.user).toBeNull();
  });
});
