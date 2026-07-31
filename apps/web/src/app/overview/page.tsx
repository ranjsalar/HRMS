"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { Skeleton } from "@/components/ui/Skeleton";
import { CompanyOverview } from "@/features/overview/CompanyOverview";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

// company_admin only — managers keep their existing department-scoped
// Team view; this is explicitly NOT a wider version of that page. A
// manager landing here is redirected to "/", same pattern Home uses for
// a superadmin session landing on the wrong page. The real boundary is
// server-side regardless (every underlying endpoint this page calls
// already scopes to the caller's own department for a manager) — this
// redirect is a UX courtesy, not the security boundary. See DECISIONS.md.
export default function OverviewPage() {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { dir } = useTranslation();
  const router = useRouter();

  const isCompanyAdmin = ready && user?.role === "company_admin";
  useEffect(() => {
    if (ready && !isCompanyAdmin) {
      router.replace("/");
    }
  }, [ready, isCompanyAdmin, router]);

  if (!ready || !isCompanyAdmin) {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
      </main>
    );
  }

  return (
    <main dir={dir} className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <AppNav />
      <CompanyOverview />
    </main>
  );
}
