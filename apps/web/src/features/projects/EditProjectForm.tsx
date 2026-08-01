"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { updateProject, type ProjectDetailDto, type ProjectDto, type ProjectStatus } from "./projects-api";

const STATUSES: ProjectStatus[] = ["planning", "active", "on_hold", "completed", "cancelled"];

/** Rendered for company_admin OR manager (own_department edit is a DEFAULT grant, unlike create) — see ProjectDetail.tsx. */
export function EditProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project: ProjectDetailDto;
  onSaved: (project: ProjectDto) => void;
  onCancel: () => void;
}) {
  const { t, dir } = useTranslation();

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [startDate, setStartDate] = useState(project.startDate?.slice(0, 10) ?? "");
  const [dueDate, setDueDate] = useState(project.dueDate?.slice(0, 10) ?? "");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const errors: Record<string, string> = {};
      if (!name.trim()) errors.name = t("common.validation.required");
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;

      setFormError(null);
      setSubmitting(true);
      try {
        const updated = await updateProject(project.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          status,
          startDate: startDate || undefined,
          dueDate: dueDate || undefined,
        });
        onSaved(updated);
      } catch (error) {
        setFormError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setSubmitting(false);
      }
    },
    [project.id, name, description, status, startDate, dueDate, onSaved, t],
  );

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-100 p-3"
      noValidate
    >
      <h3 className="font-body text-sm font-semibold text-neutral-900">{t("projects.edit.title")}</h3>

      <TextField
        label={t("projects.create.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fieldErrors.name}
      />
      <TextField
        label={t("projects.create.description")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Select
        label={t("projects.edit.status")}
        value={status}
        onChange={(e) => setStatus(e.target.value as ProjectStatus)}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`projects.status.${s}`)}
          </option>
        ))}
      </Select>
      <TextField
        type="date"
        label={t("projects.detail.startDate")}
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
      <TextField
        type="date"
        label={t("projects.detail.dueDate")}
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
          {submitting ? t("projects.edit.submitting") : t("projects.edit.submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t("projects.create.cancel")}
        </Button>
      </div>
    </form>
  );
}
