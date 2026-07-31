"use client";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { SuperAdminDashboard } from "@/features/superadmin/SuperAdminDashboard";
import { useRequireSuperAdmin } from "@/hooks/useRequireSuperAdmin";
import { useAuth } from "@/lib/auth-context";

// Deliberately its own minimal header, not the shared AppNav — AppNav
// pulls in LanguageSwitcher and links to company-scoped pages that are
// meaningless for a superadmin session. English-only throughout, by
// design (see DECISIONS.md, "Super Admin dashboard: frontend").
export default function SuperAdminPage() {
  const { ready } = useRequireSuperAdmin();
  const { logout } = useAuth();

  if (!ready) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between border-b border-neutral-200 pb-4">
        <h1 className="font-heading text-2xl text-primary">HRMS Super Admin</h1>
        <Button variant="secondary" onClick={() => void logout()}>
          Log out
        </Button>
      </header>
      <SuperAdminDashboard />
    </main>
  );
}
