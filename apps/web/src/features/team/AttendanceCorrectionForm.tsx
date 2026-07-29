"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useTranslation } from "@/lib/locale-context";
import { submitAttendanceOverride } from "./attendance-override-api";

export function AttendanceCorrectionForm({
  employeeId,
  employeeName,
  onClose,
}: {
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}) {
  const { t, dir } = useTranslation();
  const [clockIn, setClockIn] = useState("");
  const [clockOut, setClockOut] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSubmitError(null);

      // Required client-side — can't even attempt a submit without a
      // note — but this is a convenience, not the real guarantee: the
      // server independently rejects a missing note too
      // (AdminOverrideAttendanceDto: @MinLength(1)).
      if (!note.trim()) {
        setNoteError(t("attendanceCorrection.noteRequired"));
        return;
      }
      setNoteError(null);

      if (!clockIn) return;

      setSubmitting(true);
      try {
        const record = await submitAttendanceOverride({
          employeeId,
          clockIn: new Date(clockIn).toISOString(),
          clockOut: clockOut ? new Date(clockOut).toISOString() : undefined,
          note: note.trim(),
        });
        // The source is surfaced explicitly here rather than assumed —
        // this IS the confirmation that it recorded as admin_override,
        // not blended in with a normal web/mobile clock-in.
        setResult(record.source);
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : t("common.errors.generic.message"));
      } finally {
        setSubmitting(false);
      }
    },
    [note, clockIn, clockOut, employeeId, t],
  );

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3 rounded-md border border-neutral-300 bg-neutral-100 p-3"
    >
      <h3 className="font-body text-sm font-semibold text-neutral-900">
        {t("attendanceCorrection.title", { name: employeeName })}
      </h3>

      <TextField
        type="datetime-local"
        label={t("attendanceCorrection.clockIn")}
        value={clockIn}
        onChange={(e) => setClockIn(e.target.value)}
        required
      />
      <TextField
        type="datetime-local"
        label={t("attendanceCorrection.clockOut")}
        value={clockOut}
        onChange={(e) => setClockOut(e.target.value)}
      />
      <TextField
        label={t("attendanceCorrection.note")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={noteError ?? undefined}
      />

      {submitError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {submitError}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="font-body text-xs text-primary">
          {t("attendanceCorrection.success")} ({result})
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={submitting}>
          {submitting ? t("attendanceCorrection.submitting") : t("attendanceCorrection.submit")}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("attendanceCorrection.cancel")}
        </Button>
      </div>
    </form>
  );
}
