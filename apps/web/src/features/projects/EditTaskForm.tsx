"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import type { TeamMemberDto } from "@/features/team/team-api";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { updateTask, type TaskDto, type TaskStatus } from "./tasks-api";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];

/** Rendered for company_admin OR manager (own_department) — never reachable at self scope; TasksService.update() rejects that outright. Reassignment is not restricted to leaving the assignee empty — omitting the field simply leaves the current assignee unchanged (this app's UpdateTaskDto has no "unassign" path; see tasks-api.ts). */
export function EditTaskForm({
  task,
  team,
  onSaved,
  onCancel,
}: {
  task: TaskDto;
  team: TeamMemberDto[];
  onSaved: (task: TaskDto) => void;
  onCancel: () => void;
}) {
  const { t, dir } = useTranslation();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate?.slice(0, 10) ?? "");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const errors: Record<string, string> = {};
      if (!title.trim()) errors.title = t("common.validation.required");
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;

      setFormError(null);
      setSubmitting(true);
      try {
        const updated = await updateTask(task.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate || undefined,
        });
        onSaved(updated);
      } catch (error) {
        setFormError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setSubmitting(false);
      }
    },
    [task.id, title, description, status, assigneeId, dueDate, onSaved, t],
  );

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-100 p-3"
      noValidate
    >
      <h4 className="font-body text-sm font-semibold text-neutral-900">{t("tasks.edit.title")}</h4>

      <TextField
        label={t("tasks.create.taskTitle")}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={fieldErrors.title}
      />
      <TextField
        label={t("projects.create.description")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Select
        label={t("tasks.status.label")}
        value={status}
        onChange={(e) => setStatus(e.target.value as TaskStatus)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`tasks.status.${s}`)}
          </option>
        ))}
      </Select>
      <Select
        label={t("tasks.assignee")}
        value={assigneeId}
        onChange={(e) => setAssigneeId(e.target.value)}
      >
        <option value="">{t("tasks.unassigned")}</option>
        {team.map((employee) => (
          <option key={employee.id} value={employee.id}>
            {employee.fullName}
          </option>
        ))}
      </Select>
      <TextField
        type="date"
        label={t("tasks.dueDate")}
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
      />

      {formError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {formError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitting ? t("tasks.edit.submitting") : t("tasks.edit.submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t("projects.create.cancel")}
        </Button>
      </div>
    </form>
  );
}
