"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import {
  clockIn as clockInRequest,
  clockOut as clockOutRequest,
  fetchTodayAttendance,
  type AttendanceRecordDto,
} from "./attendance-api";
import { getGeoResult } from "./geolocation";

type ActionState = "idle" | "clocking-in" | "clocking-out";

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

export function ClockWidget() {
  const { t, locale, dir } = useTranslation();
  const [record, setRecord] = useState<AttendanceRecordDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [locationNotice, setLocationNotice] = useState<"denied" | "unavailable" | null>(null);
  const [actionError, setActionError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setRecord(await fetchTodayAttendance());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isOpen = record !== null && record.clockOut === null;

  const runAction = useCallback(
    async (kind: "in" | "out") => {
      setActionState(kind === "in" ? "clocking-in" : "clocking-out");
      setActionError(false);
      setLocationNotice(null);
      const geo = await getGeoResult();
      if (geo.status !== "ok") setLocationNotice(geo.status);
      try {
        const coords = geo.status === "ok" ? { lat: geo.lat, lng: geo.lng } : undefined;
        const updated = kind === "in" ? await clockInRequest(coords) : await clockOutRequest(coords);
        setRecord(updated);
      } catch {
        setActionError(true);
      } finally {
        setActionState("idle");
      }
    },
    [],
  );

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-heading text-base font-semibold text-neutral-900">
        {t("dashboard.attendance.title")}
      </h2>

      <p className="font-body text-sm text-neutral-900">
        {isOpen && record
          ? t("dashboard.attendance.statusClockedIn", {
              time: formatDate(new Date(record.clockIn), locale, TIME_FORMAT),
            })
          : record?.clockOut
            ? t("dashboard.attendance.statusClockedOut", {
                time: formatDate(new Date(record.clockOut), locale, TIME_FORMAT),
              })
            : t("dashboard.attendance.statusNotClockedIn")}
      </p>

      {locationNotice ? (
        <p className="font-body text-xs text-neutral-600">
          {t(
            locationNotice === "denied"
              ? "dashboard.attendance.locationPermissionDenied"
              : "dashboard.attendance.locationUnavailable",
          )}
        </p>
      ) : null}

      {record?.withinGeofence === false ? (
        <div role="status" className="rounded-md border border-warning/40 bg-warning/10 p-2">
          <p className="font-body text-xs font-semibold text-warning">
            {t("dashboard.attendance.geofenceWarningTitle")}
          </p>
          <p className="font-body text-xs text-neutral-700">
            {t("dashboard.attendance.geofenceWarning")}
          </p>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {t("common.errors.generic.message")}
        </p>
      ) : null}

      {isOpen ? (
        <Button
          onClick={() => void runAction("out")}
          loading={actionState === "clocking-out"}
          disabled={actionState !== "idle"}
        >
          {actionState === "clocking-out"
            ? t("dashboard.attendance.clockingOut")
            : t("dashboard.attendance.clockOut")}
        </Button>
      ) : (
        <Button
          onClick={() => void runAction("in")}
          loading={actionState === "clocking-in"}
          disabled={actionState !== "idle"}
        >
          {actionState === "clocking-in"
            ? t("dashboard.attendance.clockingIn")
            : t("dashboard.attendance.clockIn")}
        </Button>
      )}
    </div>
  );
}
