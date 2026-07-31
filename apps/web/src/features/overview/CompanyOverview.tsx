"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { fetchDepartments, type DepartmentDto } from "@/features/org/org-api";
import { fetchPendingApprovals } from "@/features/leave/leave-approvals-api";
import { fetchTeam, type TeamMemberDto } from "@/features/team/team-api";
import { formatDate } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchTodayAttendance, type AttendanceRecordDto } from "./overview-api";

const TIME_FORMAT: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

type TodayStatus = "clocked_in" | "clocked_out" | "absent";

interface AttendanceRow {
  member: TeamMemberDto;
  departmentName: string;
  status: TodayStatus;
  clockIn: string | null;
  clockOut: string | null;
}

/**
 * company_admin-only — see /overview/page.tsx for the role gate. Every
 * number here is derived client-side from data the existing endpoints
 * already return (GET /employees, GET /leave-requests?status=pending,
 * GET /attendance) — no new backend logic, per the verification pass's
 * explicit instruction to wire the frontend to what already exists.
 * A manager reaching any of these same endpoints directly would only
 * ever get their own department's slice back (server-side scope, e.g.
 * EmployeesService.scopeWhere) — this screen isn't a new data-exposure
 * surface, just a company_admin-only presentation of data the backend
 * was already willing to hand a company-wide caller.
 */
export function CompanyOverview() {
  const { t, locale, dir } = useTranslation();
  const [team, setTeam] = useState<TeamMemberDto[] | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecordDto[] | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [teamData, pending, attendance, depts] = await Promise.all([
        fetchTeam(),
        fetchPendingApprovals(),
        fetchTodayAttendance(),
        fetchDepartments(),
      ]);
      setTeam(teamData);
      setPendingCount(pending.length);
      setTodayRecords(attendance);
      setDepartments(depts);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const activeEmployees = (team ?? []).filter((m) => m.status !== "terminated");
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));

  // Latest record per employee decides today's current status — an
  // employee who clocked in and out earlier today, then clocked in
  // again, is "clocked in", not "clocked out".
  const latestRecordByEmployee = new Map<string, AttendanceRecordDto>();
  for (const record of todayRecords ?? []) {
    const existing = latestRecordByEmployee.get(record.employeeId);
    if (!existing || new Date(record.clockIn) > new Date(existing.clockIn)) {
      latestRecordByEmployee.set(record.employeeId, record);
    }
  }

  const attendanceRows: AttendanceRow[] = activeEmployees
    .map((member) => {
      const record = latestRecordByEmployee.get(member.id);
      const status: TodayStatus = !record ? "absent" : record.clockOut ? "clocked_out" : "clocked_in";
      return {
        member,
        departmentName: member.departmentId
          ? (departmentNameById.get(member.departmentId) ?? t("team.noDepartment"))
          : t("team.noDepartment"),
        status,
        clockIn: record?.clockIn ?? null,
        clockOut: record?.clockOut ?? null,
      };
    })
    // Currently-in first (most actionable at a glance), then clocked-out, then absent.
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <div dir={dir} className="flex flex-col gap-6">
      <h2 className="font-heading text-lg font-semibold text-neutral-900">{t("overview.title")}</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatTile label={t("overview.totalEmployees")} value={activeEmployees.length} />
        <StatTile label={t("overview.pendingLeaveRequests")} value={pendingCount ?? 0} />
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <h3 className="font-heading text-base font-semibold text-neutral-900">
          {t("overview.todayAttendance.title")}
        </h3>
        {attendanceRows.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {attendanceRows.map((row) => (
              <li
                key={row.member.id}
                data-employee-id={row.member.id}
                data-status={row.status}
                className="flex flex-col gap-0.5 rounded-md border border-neutral-200 p-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-body text-sm text-neutral-900">
                  {row.member.fullName} <span className="text-neutral-600">· {row.departmentName}</span>
                </span>
                <span className="font-body text-xs text-neutral-600">
                  <StatusBadge status={row.status} label={t(STATUS_LABEL_KEY[row.status])} />
                  {row.clockIn ? (
                    <>
                      {" · "}
                      {t("overview.todayAttendance.clockInTime", {
                        time: formatDate(new Date(row.clockIn), locale, TIME_FORMAT),
                      })}
                    </>
                  ) : null}
                  {row.clockOut ? (
                    <>
                      {" · "}
                      {t("overview.todayAttendance.clockOutTime", {
                        time: formatDate(new Date(row.clockOut), locale, TIME_FORMAT),
                      })}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const STATUS_ORDER: Record<TodayStatus, number> = { clocked_in: 0, clocked_out: 1, absent: 2 };

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-neutral-200 p-4">
      <span className="font-body text-xs uppercase tracking-wide text-neutral-600">{label}</span>
      <span className="font-heading text-2xl font-semibold text-primary tabular-nums">{value}</span>
    </div>
  );
}

// Explicit map, not a template-string key lookup (`` `overview.todayAttendance.${status}` ``)
// — the TodayStatus values are snake_case ("clocked_in") but the i18n
// keys are camelCase ("clockedIn", matching this file's other camelCase
// keys), so string-concatenation silently produced a key that existed
// in no locale. Found live via the real-backend integration test, which
// renders the real translated (or untranslated-key-fallback) text —
// not by inspection. See DECISIONS.md.
const STATUS_LABEL_KEY: Record<TodayStatus, string> = {
  clocked_in: "overview.todayAttendance.clockedIn",
  clocked_out: "overview.todayAttendance.clockedOut",
  absent: "overview.todayAttendance.absent",
};

function StatusBadge({ status, label }: { status: TodayStatus; label: string }) {
  const color =
    status === "clocked_in" ? "text-success" : status === "clocked_out" ? "text-neutral-600" : "text-warning";
  return <span className={color}>{label}</span>;
}
