"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import type { TeamMemberDto } from "@/features/team/team-api";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { createTask, type TaskDto } from "./tasks-api";

/**
 * Rendered for company_admin OR manager (own_department) — projects:create
 * covers both Project and Task per Projects-Module-Plan.md §3, and
 * TasksService.create() validates the target project is itself within
 * the caller's scope server-side regardless of what this form shows.
 * Assignment isn't restricted to project MEMBERS — the plan treats
 * membership and assignment as independent (§1), so `team` here is every
 * employee, not just this project's members.
 */
export function CreateTaskForm({
  projectId,
  team,
  onCreated,
  onCancel,
}: {
  projectId: string;
  team: TeamMemberDto[];
  onCreated: (task: TaskDto) => void;
  onCancel: () => void;
}) {
  const { t, dir } = useTranslation();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueDate, setDueDate] = useState("");

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
        const task = await createTask({
          projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate || undefined,
        });
        onCreated(task);
      } catch (error) {
        setFormError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setSubmitting(false);
      }
    },
    [projectId, title, description, assigneeId, dueDate, onCreated, t],
  );

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-100 p-3"
      noValidate
    >
      <h4 className="font-body text-sm font-semibold text-neutral-900">{t("tasks.create.title")}</h4>

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
          {submitting ? t("tasks.create.submitting") : t("tasks.create.submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t("projects.create.cancel")}
        </Button>
      </div>
    </form>
  );
}
