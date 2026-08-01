"use client";

import { useParams } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { Skeleton } from "@/components/ui/Skeleton";
import { ProjectDetail } from "@/features/projects/ProjectDetail";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

export default function ProjectDetailPage() {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { dir } = useTranslation();
  const params = useParams<{ id: string }>();

  if (!ready) {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
      </main>
    );
  }

  const isAdmin = user?.role === "company_admin";
  const isManager = user?.role === "manager";

  return (
    <main dir={dir} className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <AppNav />
      <ProjectDetail projectId={params.id} canManage={isAdmin || isManager} canArchive={isAdmin} />
    </main>
  );
}
