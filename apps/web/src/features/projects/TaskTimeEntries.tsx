"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import type { TeamMemberDto } from "@/features/team/team-api";
import { ApiError } from "@/lib/api-client";
import { useTranslation } from "@/lib/locale-context";
import { fetchTimeEntries, logTimeEntry, type TaskTimeEntryDto } from "./task-time-entries-api";

/**
 * Logging is assignee-only (the form only renders for `isAssignee`),
 * unconditionally by role — matches TaskTimeEntriesService.log()'s own
 * unconditional assignee check, not a scope-tiered rule. The entries
 * LIST, by contrast, is visible to anyone who can see the task at all;
 * what it actually contains is scoped server-side per role.
 *
 * `showOwnDepartmentCaveat` renders the plain-language explanation the
 * founder asked for after step 5's review: a manager's own_department
 * scope here is "entries logged by people in my department," a
 * genuinely different rule than Task's own project-membership-based
 * own_department — without this note, a manager looking at a
 * cross-departmental task with real logged hours from an out-of-department
 * assignee would see an empty (or partial) list with no explanation and
 * reasonably assume it's broken. Deliberately shown for `manager` only,
 * not `company_admin` — admin's scope is `all`, which never hits this
 * gap. See DECISIONS.md, step 5 and step 6.5.
 */
export function TaskTimeEntries({
  taskId,
  isAssignee,
  showOwnDepartmentCaveat,
  team,
}: {
  taskId: string;
  isAssignee: boolean;
  showOwnDepartmentCaveat: boolean;
  team: TeamMemberDto[];
}) {
  const { t, dir } = useTranslation();
  const [entries, setEntries] = useState<TaskTimeEntryDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [date, setDate] = useState("");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const nameByEmployeeId = new Map(team.map((e) => [e.id, e.fullName]));

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setEntries(await fetchTimeEntries(taskId));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const errors: Record<string, string> = {};
      if (!date) errors.date = t("common.validation.required");
      const hoursNumber = Number(hours);
      if (!hours || !(hoursNumber > 0)) errors.hours = t("common.validation.required");
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;

      setFormError(null);
      setSubmitting(true);
      try {
        const entry = await logTimeEntry(taskId, {
          date,
          hours: hoursNumber,
          note: note.trim() || undefined,
        });
        setEntries((current) => (current ? [entry, ...current] : [entry]));
        setDate("");
        setHours("");
        setNote("");
      } catch (error) {
        setFormError(error instanceof ApiError ? error.message : t("common.errors.generic.message"));
      } finally {
        setSubmitting(false);
      }
    },
    [taskId, date, hours, note, t],
  );

  return (
    <div dir={dir} className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3">
      <h5 className="font-body text-xs font-semibold text-neutral-900">{t("timeEntries.title")}</h5>

      {showOwnDepartmentCaveat ? (
        <p className="font-body text-xs text-neutral-600">{t("timeEntries.ownDepartmentCaveat")}</p>
      ) : null}

      {loading ? null : loadError || !entries ? (
        <p className="font-body text-xs text-danger">{t("timeEntries.loadError")}</p>
      ) : entries.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.id} data-entry-id={entry.id} className="font-body text-xs text-neutral-900">
              {entry.date.slice(0, 10)} — {entry.hours}h ·{" "}
              {nameByEmployeeId.get(entry.employeeId) ?? t("tasks.unknownAssignee")}
              {entry.note ? ` — ${entry.note}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-xs text-neutral-600">{t("timeEntries.empty")}</p>
      )}

      {isAssignee ? (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex flex-wrap items-end gap-2 border-t border-neutral-200 pt-2"
          noValidate
        >
          <TextField
            type="date"
            label={t("timeEntries.date")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={fieldErrors.date}
          />
          <TextField
            type="number"
            label={t("timeEntries.hours")}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            error={fieldErrors.hours}
          />
          <TextField label={t("timeEntries.note")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" loading={submitting} disabled={submitting}>
            {submitting ? t("timeEntries.submitting") : t("timeEntries.submit")}
          </Button>
        </form>
      ) : null}
      {formError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {formError}
        </p>
      ) : null}
    </div>
  );
}
