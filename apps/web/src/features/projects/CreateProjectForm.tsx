"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { createProject, type ProjectDto } from "./projects-api";

/**
 * Rendered for company_admin only (see projects/page.tsx) — matches
 * AddEmployeeForm's precedent for the identical RBAC shape
 * (projects:create is admin-by-default, manager-opt-in-only, exactly
 * like employees:create). Hiding this from a non-opted-in manager is a
 * UX nicety; ProjectsService.create() enforces the real boundary
 * regardless of what this form shows. See DECISIONS.md.
 */
export function CreateProjectForm({
  onCreated,
  onCancel,
}: {
  onCreated: (project: ProjectDto) => void;
  onCancel: () => void;
}) {
  const { t, dir } = useTranslation();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");

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
        const project = await createProject({
          name: name.trim(),
          description: description.trim() || undefined,
          startDate: startDate || undefined,
          dueDate: dueDate || undefined,
        });
        onCreated(project);
      } catch (error) {
        setFormError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setSubmitting(false);
      }
    },
    [name, description, startDate, dueDate, onCreated, t],
  );

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-100 p-3"
      noValidate
    >
      <h3 className="font-body text-sm font-semibold text-neutral-900">{t("projects.create.title")}</h3>

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
          {submitting ? t("projects.create.submitting") : t("projects.create.submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          {t("projects.create.cancel")}
        </Button>
      </div>
    </form>
  );
}
