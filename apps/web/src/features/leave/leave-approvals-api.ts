import { apiFetch } from "@/lib/api-client";
import type { LeaveBalanceDto } from "./leave-api";
import type { LeaveRequestDto } from "./leave-requests-api";

/**
 * Deliberately no client-side filtering by department — `GET
 * /leave-requests?status=pending` already resolves the caller's scope
 * server-side (own_department for a manager, all for company_admin). If
 * the server ever returned a request outside the caller's department,
 * that should be visibly wrong here, not silently corrected by this
 * file. Mirrors `team-api.ts`'s `fetchTeam()` — same principle, same
 * endpoint family.
 */
export function fetchPendingApprovals(): Promise<LeaveRequestDto[]> {
  return apiFetch<LeaveRequestDto[]>("/leave-requests?status=pending");
}

export function fetchEmployeeBalances(employeeId: string): Promise<LeaveBalanceDto[]> {
  return apiFetch<LeaveBalanceDto[]>(`/leave-balances?employeeId=${employeeId}`);
}

export function previewApprovalWorkingDays(
  startDate: string,
  endDate: string,
): Promise<{ workingDays: number }> {
  return apiFetch<{ workingDays: number }>(
    `/leave-requests/preview?startDate=${startDate}&endDate=${endDate}`,
  );
}

export function approveLeaveRequest(id: string, force?: boolean): Promise<LeaveRequestDto> {
  return apiFetch<LeaveRequestDto>(`/leave-requests/${id}/approve`, {
    method: "POST",
    body: force ? { force: true } : {},
  });
}

export function rejectLeaveRequest(id: string): Promise<LeaveRequestDto> {
  return apiFetch<LeaveRequestDto>(`/leave-requests/${id}/reject`, { method: "POST" });
}
