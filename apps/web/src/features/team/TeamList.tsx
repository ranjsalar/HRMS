"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchTeam, type TeamMemberDto } from "./team-api";

export function TeamList({
  renderRowAction,
}: {
  /** Injected per-row, rather than owned here — keeps the attendance-correction UI (9.5) scoped to exactly the employees this list actually rendered, never a separately-typed id. */
  renderRowAction?: (member: TeamMemberDto) => React.ReactNode;
}) {
  const { t, locale, dir } = useTranslation();
  const [team, setTeam] = useState<TeamMemberDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setTeam(await fetchTeam());
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
      <h2 className="font-heading text-base font-semibold text-neutral-900">{t("team.title")}</h2>
      {team && team.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {team.map((member) => (
            <li key={member.id} data-employee-id={member.id} className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="font-body text-sm font-medium text-neutral-900">
                    {member.fullName}
                  </span>
                  <span className="font-body text-xs text-neutral-600">
                    {member.jobTitle} · {t(`team.status.${member.status}`)} ·{" "}
                    {t("team.hireDate")}: {formatDate(new Date(member.hireDate), locale)}
                  </span>
                </div>
                {renderRowAction ? renderRowAction(member) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("team.empty")}</p>
      )}
    </div>
  );
}
