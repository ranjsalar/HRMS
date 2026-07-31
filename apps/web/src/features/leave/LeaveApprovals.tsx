"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate, formatNumber } from "@/lib/locale";
import { useTranslation } from "@/lib/locale-context";
import { fetchActiveLeaveTypes, type LeaveTypeDto } from "./leave-api";
import {
  approveLeaveRequest,
  fetchEmployeeBalances,
  fetchPendingApprovals,
  previewApprovalWorkingDays,
  rejectLeaveRequest,
} from "./leave-approvals-api";
import type { LeaveRequestDto } from "./leave-requests-api";
import { fetchTeam, type TeamMemberDto } from "@/features/team/team-api";
import { fetchDepartments } from "@/features/org/org-api";

export function LeaveApprovals() {
  const { t, dir } = useTranslation();
  const [requests, setRequests] = useState<LeaveRequestDto[] | null>(null);
  const [employeeNameById, setEmployeeNameById] = useState<Map<string, string>>(new Map());
  const [employeeDepartmentNameById, setEmployeeDepartmentNameById] = useState<Map<string, string>>(
    new Map(),
  );
  const [leaveTypeById, setLeaveTypeById] = useState<Map<string, LeaveTypeDto>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [pending, team, types, departments] = await Promise.all([
        fetchPendingApprovals(),
        fetchTeam(),
        fetchActiveLeaveTypes(),
        fetchDepartments(),
      ]);
      setRequests(pending);
      setEmployeeNameById(new Map(team.map((m: TeamMemberDto) => [m.id, m.fullName])));
      setLeaveTypeById(new Map(types.map((lt) => [lt.id, lt])));
      const departmentNameById = new Map(departments.map((d) => [d.id, d.name]));
      setEmployeeDepartmentNameById(
        new Map(
          team.map((m: TeamMemberDto) => [
            m.id,
            m.departmentId ? (departmentNameById.get(m.departmentId) ?? t("team.noDepartment")) : t("team.noDepartment"),
          ]),
        ),
      );
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDecided = useCallback((requestId: string) => {
    setRequests((prev) => (prev ? prev.filter((r) => r.id !== requestId) : prev));
  }, []);

  if (loading) {
    return (
      <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState kind="generic" onRetry={() => void load()} />;
  }

  return (
    <div dir={dir} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-heading text-base font-semibold text-neutral-900">
        {t("leaveApprovals.title")}
      </h2>
      {requests && requests.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {requests.map((request) => (
            <ApprovalRow
              key={request.id}
              request={request}
              employeeName={employeeNameById.get(request.employeeId) ?? request.employeeId}
              departmentName={employeeDepartmentNameById.get(request.employeeId) ?? null}
              leaveType={leaveTypeById.get(request.leaveTypeId) ?? null}
              onDecided={() => handleDecided(request.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="font-body text-sm text-neutral-600">{t("leaveApprovals.empty")}</p>
      )}
    </div>
  );
}

function ApprovalRow({
  request,
  employeeName,
  departmentName,
  leaveType,
  onDecided,
}: {
  request: LeaveRequestDto;
  employeeName: string;
  departmentName: string | null;
  leaveType: LeaveTypeDto | null;
  onDecided: () => void;
}) {
  const { t, locale } = useTranslation();
  const [workingDays, setWorkingDays] = useState<number | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [preview, balances] = await Promise.all([
          previewApprovalWorkingDays(request.startDate, request.endDate),
          fetchEmployeeBalances(request.employeeId),
        ]);
        if (cancelled) return;
        setWorkingDays(preview.workingDays);
        const match = balances.find((b) => b.leaveTypeId === request.leaveTypeId);
        setBalance(match ? Number(match.balance) : null);
      } catch {
        if (!cancelled) {
          setWorkingDays(null);
          setBalance(null);
        }
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request.startDate, request.endDate, request.employeeId, request.leaveTypeId]);

  const handleApprove = useCallback(async () => {
    setDeciding("approve");
    setDecisionError(null);
    try {
      await approveLeaveRequest(request.id);
      onDecided();
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : t("common.errors.generic.message"));
    } finally {
      setDeciding(null);
    }
  }, [request.id, onDecided, t]);

  const handleReject = useCallback(async () => {
    setDeciding("reject");
    setDecisionError(null);
    try {
      await rejectLeaveRequest(request.id);
      onDecided();
    } catch (error) {
      setDecisionError(error instanceof Error ? error.message : t("common.errors.generic.message"));
    } finally {
      setDeciding(null);
    }
  }, [request.id, onDecided, t]);

  const wouldExceed = balance !== null && workingDays !== null && workingDays > balance;

  return (
    <li
      data-request-id={request.id}
      className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-body text-sm font-medium text-neutral-900">
          {employeeName}
          {departmentName ? ` · ${departmentName}` : ""} — {leaveType?.name ?? request.leaveTypeId}
        </span>
        <span className="font-body text-xs text-neutral-600">
          {t("leave.history.dateRange", {
            start: formatDate(new Date(request.startDate), locale),
            end: formatDate(new Date(request.endDate), locale),
          })}
        </span>
        {contextLoading ? (
          <span className="font-body text-xs text-neutral-600">
            {t("leaveApprovals.contextLoading")}
          </span>
        ) : (
          <span className="flex flex-wrap gap-x-1 font-body text-xs text-neutral-600">
            {workingDays !== null ? (
              <span>{t("leave.submit.previewDays", { count: formatNumber(workingDays, locale) })}</span>
            ) : null}
            {balance !== null ? (
              <span>
                {t("leave.submit.balanceForType", {
                  count: formatNumber(balance, locale, { maximumFractionDigits: 2 }),
                })}
              </span>
            ) : null}
          </span>
        )}
        {wouldExceed ? (
          <span className="font-body text-xs text-warning">{t("leave.submit.wouldExceedBalance")}</span>
        ) : null}
      </div>

      {decisionError ? (
        <p role="alert" className="font-body text-xs text-danger">
          {decisionError}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button
          onClick={() => void handleApprove()}
          loading={deciding === "approve"}
          disabled={deciding !== null}
        >
          {deciding === "approve" ? t("leaveApprovals.approving") : t("leaveApprovals.approve")}
        </Button>
        <Button
          variant="secondary"
          onClick={() => void handleReject()}
          loading={deciding === "reject"}
          disabled={deciding !== null}
        >
          {deciding === "reject" ? t("leaveApprovals.rejecting") : t("leaveApprovals.reject")}
        </Button>
      </div>
    </li>
  );
}
