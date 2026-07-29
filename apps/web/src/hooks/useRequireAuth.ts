"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/**
 * The one place "where does an authenticated-but-not-quite-ready session
 * go" is decided, so every protected page asks this instead of
 * re-implementing the same three-way branch. Mirrors the backend's own
 * guard order (AuthGuard -> MustChangePasswordGuard, see DECISIONS.md):
 * no session -> /login; a session that still owes a password change ->
 * /change-password (which is itself exempt from this hook — see that
 * page); anything else -> ready.
 */
export function useRequireAuth(): { ready: boolean } {
  const { status, mustChangePassword } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated" && mustChangePassword) {
      router.replace("/change-password");
    }
  }, [status, mustChangePassword, router]);

  return { ready: status === "authenticated" && !mustChangePassword };
}
