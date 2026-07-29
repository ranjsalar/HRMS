"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchActiveLeaveTypes, type LeaveTypeDto } from "./leave-api";
import { cancelLeaveRequest, fetchMyLeaveRequests, type LeaveRequestDto } from "./leave-requests-api";

export function LeaveRequestHistory({ refreshToken }: { refreshToken: number }) {
  const { t, locale, dir } = useTranslation();
  const [requests, setRequests] = useState<LeaveRequestDto[] | null>(null);
  const [leaveTypeNameById, setLeaveTypeNameById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [reqs, types] = await Promise.all([fetchMyLeaveRequests(), fetchActiveLeaveTypes()]);
      setRequests(reqs);
      setLeaveTypeNameById(new Map(types.map((lt: LeaveTypeDto) => [lt.id, lt.name])));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // refreshToken bumps after the sibling submit form successfully creates a
  // request — reloads history without the two components needing a shared
  // store, matching this app's existing "lift a counter, not the data"
  // convention for cross-widget refresh.
  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const handleCancel = useCallback(
    async (id: string) => {
      setCancellingId(id);
      try {
        const updated = await cancelLeaveRequest(id);
        setRequests((prev) => (prev ? prev.map((r) => (r.id === id ? updated : r)) : prev));
      } catch {
        // Best-effort: a full reload will show the real current state
        // either way if this silently failed for a reason worth surfacing.
        void load();
      } finally {
        setCancellingId(null);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-40" />
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
      <h2 className="font-heading text-base font-semibold text-neutral-900">
        {t("leave.history.title")}
      </h2>
      {requests && requests.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <li
              key={request.id}
              data-request-id={request.id}
              className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-body text-sm font-medium text-neutral-900">
                  {leaveTypeNameById.get(request.leaveTypeId) ?? request.leaveTypeId}
                </span>
                <span className="font-body text-xs text-neutral-600">
                  {t("leave.history.dateRange", {
                    start: formatDate(new Date(request.startDate), locale),
                    end: formatDate(new Date(request.endDate), locale),
                  })}
                </span>
                {request.workingDays !== null ? (
                  <span className="font-body text-xs text-neutral-600">
                    {t("leave.history.workingDays", { count: request.workingDays })}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-neutral-100 px-2 py-1 font-body text-xs text-neutral-900">
                  {t(`leave.history.status.${request.status}`)}
                </span>
                {/* Structurally impossible to cancel a non-pending request
                    from this UI — the button simply isn't rendered, not
                    hidden via CSS/disabled. Server independently enforces
                    the same rule (LeaveRequestsService.cancel). */}
                {request.status === "pending" ? (
                  <Button
                    variant="secondary"
                    onClick={() => void handleCancel(request.id)}
                    loading={cancellingId === request.id}
                    disabled={cancellingId !== null}
                  >
                    {cancellingId === request.id
                      ? t("leave.history.cancelling")
                      : t("leave.history.cancel")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("leave.history.empty")}</p>
      )}
    </div>
  );
}
