"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { CreateProjectForm } from "@/features/projects/CreateProjectForm";
import { ProjectList } from "@/features/projects/ProjectList";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/locale-context";

export default function ProjectsPage() {
  const { ready } = useRequireAuth();
  const { user } = useAuth();
  const { t, dir } = useTranslation();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  if (!ready) {
    return (
      <main dir={dir} className="flex min-h-screen flex-col items-center gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
      </main>
    );
  }

  // company_admin only — matches AddEmployeeForm's precedent for the
  // identical RBAC shape (admin-by-default, manager-opt-in-only). See
  // CreateProjectForm's own comment.
  const isAdmin = user?.role === "company_admin";

  return (
    <main dir={dir} className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 p-8">
      <AppNav />

      {isAdmin ? (
        creating ? (
          <CreateProjectForm
            onCreated={(project) => router.push(`/projects/${project.id}`)}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Button onClick={() => setCreating(true)} className="self-start">
            {t("projects.create.addButton")}
          </Button>
        )
      ) : null}

      <ProjectList />
    </main>
  );
}
