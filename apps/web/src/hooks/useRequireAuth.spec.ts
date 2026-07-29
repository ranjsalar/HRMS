import { renderHook } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/lib/auth-context";
import { useRequireAuth } from "./useRequireAuth";

vi.mock("@/lib/auth-context", () => ({ useAuth: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: vi.fn() }));

const mockedUseAuth = vi.mocked(useAuth);
const mockedUseRouter = vi.mocked(useRouter);

describe("useRequireAuth", () => {
  const replace = vi.fn();

  beforeEach(() => {
    replace.mockClear();
    mockedUseRouter.mockReturnValue({ replace } as unknown as ReturnType<typeof useRouter>);
  });

  it("redirects to /login when unauthenticated, and reports not ready", () => {
    mockedUseAuth.mockReturnValue({
      status: "unauthenticated",
      mustChangePassword: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useRequireAuth());

    expect(replace).toHaveBeenCalledWith("/login");
    expect(result.current.ready).toBe(false);
  });

  it("redirects to /change-password when authenticated but mustChangePassword is true", () => {
    mockedUseAuth.mockReturnValue({
      status: "authenticated",
      mustChangePassword: true,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useRequireAuth());

    expect(replace).toHaveBeenCalledWith("/change-password");
    expect(result.current.ready).toBe(false);
  });

  it("is ready with no redirect once authenticated and the password is current", () => {
    mockedUseAuth.mockReturnValue({
      status: "authenticated",
      mustChangePassword: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(true);
  });

  it("is not ready while the initial silent-refresh is still loading, and does not redirect yet", () => {
    mockedUseAuth.mockReturnValue({
      status: "loading",
      mustChangePassword: false,
    } as unknown as ReturnType<typeof useAuth>);

    const { result } = renderHook(() => useRequireAuth());

    expect(replace).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
  });
});
