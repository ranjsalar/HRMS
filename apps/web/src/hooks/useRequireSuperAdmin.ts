"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * Mirrors useRequireAuth's redirect logic (no session -> /login, a
 * pending password change -> /change-password) with one addition: a
 * non-superadmin session is sent to the regular home dashboard, not just
 * left on the page. This is a client-side convenience only — the real
 * enforcement is server-side (SuperAdminGuard on every /superadmin/*
 * endpoint); this hook existing or not existing has no bearing on
 * whether a company_admin could actually read/write superadmin data.
 */
export function useRequireSuperAdmin(): { ready: boolean } {
  const { status, mustChangePassword, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && mustChangePassword) {
      router.replace("/change-password");
    } else if (status === "authenticated" && user && user.role !== "superadmin") {
      router.replace("/");
    }
  }, [status, mustChangePassword, user, router]);

  return {
    ready: status === "authenticated" && !mustChangePassword && user?.role === "superadmin",
  };
}
