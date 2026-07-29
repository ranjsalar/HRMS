"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, setAccessToken as setClientAccessToken, setAuthFailureHandler } from "./api-client";

export type RoleName = "superadmin" | "company_admin" | "manager" | "employee";

export interface AuthUser {
  userId: string;
  companyId: string | null;
  role: RoleName;
  email: string | null;
}

interface LoginOkResponse {
  status: "ok";
  accessToken: string;
  mustChangePassword: boolean;
}
interface LoginPendingResponse {
  status: "2fa_required" | "2fa_enrollment_required";
  pendingToken: string;
}
export type LoginResponse = LoginOkResponse | LoginPendingResponse;

interface SessionResponse {
  accessToken: string;
  mustChangePassword: boolean;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Mirrors the backend's MustChangePasswordGuard: true means every route except the change-password screen should redirect there — enforced by the app's route layout, not by this context itself. */
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<LoginResponse>;
  /** Called by the 2FA verify/enroll screens once they've obtained a full session (same {accessToken, mustChangePassword} shape login() returns on immediate success). */
  establishSession: (accessToken: string, mustChangePassword: boolean) => Promise<void>;
  /** Called by the change-password screen right after POST /auth/password/change succeeds — that endpoint already flips User.mustChangePassword to false server-side (see DECISIONS.md); this just brings the in-memory flag in line without a wasted extra round-trip. */
  clearMustChangePassword: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const clearSession = useCallback(() => {
    setClientAccessToken(null);
    setUser(null);
    setMustChangePassword(false);
    setStatus("unauthenticated");
  }, []);

  // api-client fires this when a 401's silent refresh-and-retry itself
  // fails mid-session (token expired, refresh cookie also gone/revoked) —
  // the one place a session ends involuntarily, from any API call
  // anywhere in the app, not just ones this provider initiated.
  useEffect(() => {
    setAuthFailureHandler(clearSession);
    return () => setAuthFailureHandler(null);
  }, [clearSession]);

  const establishSession = useCallback(
    async (accessToken: string, mcp: boolean): Promise<void> => {
      setClientAccessToken(accessToken);
      setMustChangePassword(mcp);
      try {
        const me = await apiFetch<AuthUser>("/auth/me");
        setUser(me);
        setStatus("authenticated");
      } catch {
        clearSession();
      }
    },
    [clearSession],
  );

  // Silent refresh on load: the httpOnly refresh cookie (if any, from a
  // previous session) is sent automatically; success re-establishes a
  // session with no visible login step, failure just means "not logged
  // in" — never surfaced as an error to the user.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<SessionResponse>("/auth/refresh", { method: "POST" });
        if (!cancelled) await establishSession(res.accessToken, res.mustChangePassword);
      } catch {
        if (!cancelled) clearSession();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only — establishSession/clearSession are stable
    // (useCallback with stable deps), and re-running this on every
    // identity change would re-trigger the silent refresh pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResponse> => {
      const res = await apiFetch<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
      });
      if (res.status === "ok") {
        await establishSession(res.accessToken, res.mustChangePassword);
      }
      return res;
    },
    [establishSession],
  );

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    // The local session clears regardless of whether the backend call
    // succeeds — from the user's perspective "log me out" always works,
    // and there's nothing useful for the UI to do differently if the
    // network request itself failed (the refresh cookie may already be
    // gone server-side by the time this runs anyway).
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout request failed; clearing the local session anyway.", error);
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      mustChangePassword,
      login,
      establishSession,
      clearMustChangePassword,
      logout,
    }),
    [status, user, mustChangePassword, login, establishSession, clearMustChangePassword, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
