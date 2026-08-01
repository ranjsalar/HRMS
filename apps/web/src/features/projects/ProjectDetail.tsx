"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchProject, type ProjectDetailDto } from "./projects-api";

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { t, locale, dir } = useTranslation();
  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setProject(await fetchProject(projectId));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (loadError || !project) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-4">
      <Link href="/projects" className="font-body text-sm text-primary hover:underline">
        {t("projects.detail.backToList")}
      </Link>

      <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-heading text-lg font-semibold text-neutral-900">{project.name}</h2>
          <span className="font-body text-xs text-neutral-600">
            {t(`projects.status.${project.status}`)}
          </span>
        </div>
        <p className="font-body text-sm text-neutral-900">
          {project.description || t("projects.detail.noDescription")}
        </p>
        <p className="font-body text-xs text-neutral-600">
          {project.startDate || project.dueDate
            ? [
                project.startDate
                  ? `${t("projects.detail.startDate")}: ${formatDate(new Date(project.startDate), locale)}`
                  : null,
                project.dueDate
                  ? `${t("projects.detail.dueDate")}: ${formatDate(new Date(project.dueDate), locale)}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : t("projects.detail.noDates")}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <h3 className="font-heading text-base font-semibold text-neutral-900">
          {t("projects.detail.membersTitle")}
        </h3>
        {project.members.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {project.members.map((member) => (
              <li
                key={member.id}
                data-employee-id={member.employeeId}
                className="font-body text-sm text-neutral-900"
              >
                {member.employee.fullName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-body text-sm text-neutral-600">{t("projects.detail.noMembers")}</p>
        )}
      </div>
    </div>
  );
}
