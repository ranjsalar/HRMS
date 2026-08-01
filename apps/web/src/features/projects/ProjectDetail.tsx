"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchTeam, type TeamMemberDto } from "@/features/team/team-api";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { EditProjectForm } from "./EditProjectForm";
import {
  addProjectMember,
  archiveProject,
  fetchProject,
  removeProjectMember,
  type ProjectDetailDto,
} from "./projects-api";
import { TaskList } from "./TaskList";

export function ProjectDetail({
  projectId,
  canManage = false,
  canArchive = false,
}: {
  projectId: string;
  /** Edit + add/remove members — company_admin (all) or manager (own_department, a DEFAULT grant, unlike create). */
  canManage?: boolean;
  /** Archive — company_admin only by default, matching projects:delete never being a default manager grant (see DECISIONS.md, step 2). */
  canArchive?: boolean;
}) {
  const { t, locale, dir } = useTranslation();
  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

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

  const handleArchive = useCallback(async () => {
    setArchiveError(null);
    setArchiving(true);
    try {
      await archiveProject(projectId);
      setConfirmingArchive(false);
      await load();
    } catch (error) {
      setArchiveError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
    } finally {
      setArchiving(false);
    }
  }, [projectId, load, t]);

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

      {editing ? (
        <EditProjectForm
          project={project}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
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

          {canManage || canArchive ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {canManage ? (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t("projects.edit.editButton")}
                </Button>
              ) : null}
              {canArchive && project.status !== "cancelled" ? (
                confirmingArchive ? (
                  <span className="flex items-center gap-2">
                    <span className="font-body text-xs text-neutral-900">
                      {t("projects.archive.confirmPrompt")}
                    </span>
                    <Button onClick={() => void handleArchive()} loading={archiving} disabled={archiving}>
                      {t("projects.archive.confirmButton")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmingArchive(false)}
                      disabled={archiving}
                    >
                      {t("projects.create.cancel")}
                    </Button>
                  </span>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmingArchive(true)}>
                    {t("projects.archive.button")}
                  </Button>
                )
              ) : null}
            </div>
          ) : null}
          {archiveError ? (
            <p role="alert" className="font-body text-xs text-danger">
              {archiveError}
            </p>
          ) : null}
        </div>
      )}

      <ProjectMembers project={project} canManage={canManage} onChanged={() => void load()} />

      <TaskList projectId={project.id} canManage={canManage} />
    </div>
  );
}

function ProjectMembers({
  project,
  canManage,
  onChanged,
}: {
  project: ProjectDetailDto;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { t, dir } = useTranslation();
  const [team, setTeam] = useState<TeamMemberDto[]>([]);
  const [addingMemberId, setAddingMemberId] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    void fetchTeam().then(setTeam).catch(() => setTeam([]));
  }, [canManage]);

  const memberIds = new Set(project.members.map((m) => m.employeeId));
  const candidates = team.filter((e) => !memberIds.has(e.id));

  const handleAdd = useCallback(async () => {
    if (!addingMemberId) return;
    setActionError(null);
    setAdding(true);
    try {
      await addProjectMember(project.id, addingMemberId);
      setAddingMemberId("");
      onChanged();
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
    } finally {
      setAdding(false);
    }
  }, [project.id, addingMemberId, onChanged, t]);

  const handleRemove = useCallback(
    async (employeeId: string) => {
      setActionError(null);
      setRemovingId(employeeId);
      try {
        await removeProjectMember(project.id, employeeId);
        onChanged();
      } catch (error) {
        setActionError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setRemovingId(null);
      }
    },
    [project.id, onChanged, t],
  );

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h3 className="font-heading text-base font-semibold text-neutral-900">
        {t("projects.detail.membersTitle")}
      </h3>
      {project.members.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {project.members.map((member) => (
            <li
              key={member.id}
              data-employee-id={member.employeeId}
              className="flex items-center justify-between gap-2"
            >
              <span className="font-body text-sm text-neutral-900">{member.employee.fullName}</span>
              {canManage ? (
                <Button
                  variant="secondary"
                  onClick={() => void handleRemove(member.employeeId)}
                  loading={removingId === member.employeeId}
                  disabled={removingId !== null}
                >
                  {t("projects.members.removeButton")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("projects.detail.noMembers")}</p>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-3">
          <Select
            label={t("projects.members.addLabel")}
            value={addingMemberId}
            onChange={(e) => setAddingMemberId(e.target.value)}
          >
            <option value="">{t("projects.members.addPlaceholder")}</option>
            {candidates.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName}
              </option>
            ))}
          </Select>
          <Button
            onClick={() => void handleAdd()}
            loading={adding}
            disabled={adding || !addingMemberId}
          >
            {t("projects.members.addButton")}
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
