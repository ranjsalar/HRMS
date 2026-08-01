"use client";

import { useCallback, useEffect, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchTeam, type TeamMemberDto } from "@/features/team/team-api";
import { fetchMyProfile } from "@/features/profile/profile-api";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { fetchTasks, updateTaskStatus, type TaskDto, type TaskStatus } from "./tasks-api";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

/**
 * The employee status-only control lives HERE, not in a general edit
 * form — matches the backend's own asymmetric self-scope shape
 * (TasksService.updateStatus): only the task's real assignee gets an
 * interactive control, via the dedicated PATCH /tasks/:id/status route.
 * Everyone else (including admin/manager viewing here) sees status as
 * plain text — full task editing (title/description/reassignment) is
 * step 6.4's own, separate surface, not this one.
 */
export function TaskList({ projectId }: { projectId: string }) {
  const { t, dir } = useTranslation();
  const [tasks, setTasks] = useState<TaskDto[] | null>(null);
  const [team, setTeam] = useState<TeamMemberDto[]>([]);
  const [ownEmployeeId, setOwnEmployeeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [allTasks, profile] = await Promise.all([fetchTasks(), fetchMyProfile()]);
      setTasks(allTasks.filter((task) => task.projectId === projectId));
      setOwnEmployeeId(profile.id);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchTeam().then(setTeam).catch(() => setTeam([]));
  }, []);

  const nameByEmployeeId = new Map(team.map((e) => [e.id, e.fullName]));

  const handleStatusChange = useCallback(
    async (taskId: string, status: TaskStatus) => {
      setRowError(null);
      setSavingId(taskId);
      try {
        const updated = await updateTaskStatus(taskId, status);
        setTasks((current) => current?.map((t) => (t.id === taskId ? updated : t)) ?? null);
      } catch (error) {
        setRowError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setSavingId(null);
      }
    },
    [t],
  );

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (loadError || !tasks) {
    return <p className="font-body text-sm text-danger">{t("tasks.loadError")}</p>;
  }

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h3 className="font-heading text-base font-semibold text-neutral-900">{t("tasks.title")}</h3>
      {tasks.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const isAssignee = ownEmployeeId !== null && task.assigneeId === ownEmployeeId;
            const assigneeName = task.assigneeId
              ? (nameByEmployeeId.get(task.assigneeId) ?? t("tasks.unknownAssignee"))
              : t("tasks.unassigned");
            return (
              <li
                key={task.id}
                data-task-id={task.id}
                className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-body text-sm font-medium text-neutral-900">{task.title}</span>
                  <span className="font-body text-xs text-neutral-600">{assigneeName}</span>
                </div>
                {isAssignee ? (
                  <Select
                    label={t("tasks.status.label")}
                    value={task.status}
                    onChange={(e) => void handleStatusChange(task.id, e.target.value as TaskStatus)}
                    disabled={savingId === task.id}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`tasks.status.${s}`)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="font-body text-xs text-neutral-600">
                    {t(`tasks.status.${task.status}`)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("tasks.empty")}</p>
      )}
      {rowError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {rowError}
        </p>
      ) : null}
    </div>
  );
}
