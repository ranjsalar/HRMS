"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { TextField } from "@/components/ui/TextField";
import { ConflictError, ValidationError } from "@/lib/api-client";
import { formatNumber } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchActiveLeaveTypes, fetchMyLeaveBalances, type LeaveTypeDto } from "./leave-api";
import { previewWorkingDays, submitLeaveRequest } from "./leave-requests-api";

export function LeaveSubmitForm({ onSubmitted }: { onSubmitted: () => void }) {
  const { t, locale, dir } = useTranslation();

  const [leaveTypes, setLeaveTypes] = useState<LeaveTypeDto[]>([]);
  const [balanceByTypeId, setBalanceByTypeId] = useState<Map<string, number>>(new Map());

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [previewDays, setPreviewDays] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [types, balances] = await Promise.all([fetchActiveLeaveTypes(), fetchMyLeaveBalances()]);
        setLeaveTypes(types);
        setBalanceByTypeId(new Map(balances.map((b) => [b.leaveTypeId, Number(b.balance)])));
      } catch {
        // Non-fatal for this widget: the form still works without the
        // dropdown pre-populated correctly is unlikely to help, but a
        // failed balance fetch specifically shouldn't block the form —
        // the balance display simply stays empty for that type.
      }
    })();
  }, []);

  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate) {
      setPreviewDays(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void previewWorkingDays(startDate, endDate)
      .then((res) => {
        if (!cancelled) setPreviewDays(res.workingDays);
      })
      .catch(() => {
        if (!cancelled) setPreviewDays(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!leaveTypeId) errors.leaveTypeId = t("common.validation.required");
    if (!startDate) errors.startDate = t("common.validation.required");
    if (!endDate) errors.endDate = t("common.validation.required");
    if (startDate && endDate && endDate < startDate) {
      errors.endDate = t("leave.submit.endDateBeforeStart");
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [leaveTypeId, startDate, endDate, t]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSubmitError(null);
      setSuccessMessage(null);
      if (!validate()) return;

      setSubmitting(true);
      try {
        await submitLeaveRequest({
          leaveTypeId,
          startDate,
          endDate,
          reason: reason.trim() ? reason.trim() : undefined,
        });
        setSuccessMessage(t("leave.submit.success"));
        setLeaveTypeId("");
        setStartDate("");
        setEndDate("");
        setReason("");
        setPreviewDays(null);
        onSubmitted();
      } catch (error) {
        // Real server messages for validation/conflict cases (insufficient
        // balance, overlapping request) — these are dynamic (they embed
        // the actual computed numbers) and can't be pre-translated the way
        // auth's fixed-message set was in 9.1. See DECISIONS.md.
        if (error instanceof ConflictError || error instanceof ValidationError) {
          setSubmitError(error.message);
        } else {
          setSubmitError(t("common.errors.generic.message"));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [validate, leaveTypeId, startDate, endDate, reason, onSubmitted, t],
  );

  const selectedBalance = leaveTypeId ? (balanceByTypeId.get(leaveTypeId) ?? null) : null;
  const wouldExceed =
    selectedBalance !== null && previewDays !== null && previewDays > selectedBalance;

  return (
    <form
      dir={dir}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4"
    >
      <h2 className="font-heading text-base font-semibold text-neutral-900">
        {t("leave.submit.title")}
      </h2>

      <Select
        label={t("leave.submit.leaveType")}
        value={leaveTypeId}
        onChange={(e) => setLeaveTypeId(e.target.value)}
        error={fieldErrors.leaveTypeId}
      >
        <option value="">{t("leave.submit.leaveTypePlaceholder")}</option>
        {leaveTypes.map((lt) => (
          <option key={lt.id} value={lt.id}>
            {lt.name}
          </option>
        ))}
      </Select>

      {selectedBalance !== null ? (
        <p className="font-body text-xs text-neutral-600">
          {t("leave.submit.balanceForType", {
            count: formatNumber(selectedBalance, locale, { maximumFractionDigits: 2 }),
          })}
        </p>
      ) : null}

      <TextField
        type="date"
        label={t("leave.submit.startDate")}
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        error={fieldErrors.startDate}
      />
      <TextField
        type="date"
        label={t("leave.submit.endDate")}
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
        error={fieldErrors.endDate}
      />

      <p className="font-body text-sm text-neutral-900">
        {previewLoading
          ? t("leave.submit.previewLoading")
          : previewDays !== null
            ? t("leave.submit.previewDays", {
                count: formatNumber(previewDays, locale),
              })
            : t("leave.submit.previewPending")}
      </p>

      {wouldExceed ? (
        <p className="font-body text-xs text-warning">{t("leave.submit.wouldExceedBalance")}</p>
      ) : null}

      <TextField
        label={t("leave.submit.reason")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      {submitError ? (
        <p role="alert" className="font-body text-sm text-danger">
          {submitError}
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" className="font-body text-sm text-primary">
          {successMessage}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} disabled={submitting}>
        {submitting ? t("leave.submit.submitting") : t("leave.submit.submit")}
      </Button>
    </form>
  );
}
