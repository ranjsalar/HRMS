"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchProjects, type ProjectDto } from "./projects-api";

export function ProjectList() {
  const { t, locale, dir } = useTranslation();
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setProjects(await fetchProjects());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-heading text-base font-semibold text-neutral-900">{t("projects.title")}</h2>
      {projects && projects.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {projects.map((project) => (
            <li key={project.id} data-project-id={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 hover:bg-neutral-100 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-body text-sm font-medium text-neutral-900">{project.name}</span>
                <span className="font-body text-xs text-neutral-600">
                  {t(`projects.status.${project.status}`)}
                  {project.dueDate
                    ? ` · ${t("projects.detail.dueDate")}: ${formatDate(new Date(project.dueDate), locale)}`
                    : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("projects.empty")}</p>
      )}
    </div>
  );
}
