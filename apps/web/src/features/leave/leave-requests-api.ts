import { apiFetch } from "@/lib/api-client";

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface LeaveRequestDto {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  status: LeaveRequestStatus;
  workingDays: string | null; // Decimal over JSON — see leave-api.ts's note on LeaveBalanceDto.balance
  reason: string | null;
  createdAt: string;
}

export function fetchMyLeaveRequests(): Promise<LeaveRequestDto[]> {
  return apiFetch<LeaveRequestDto[]>("/leave-requests/me");
}

export function submitLeaveRequest(input: {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}): Promise<LeaveRequestDto> {
  return apiFetch<LeaveRequestDto>("/leave-requests", { method: "POST", body: input });
}

export function cancelLeaveRequest(id: string): Promise<LeaveRequestDto> {
  return apiFetch<LeaveRequestDto>(`/leave-requests/${id}/cancel`, { method: "POST" });
}

export function previewWorkingDays(startDate: string, endDate: string): Promise<{ workingDays: number }> {
  return apiFetch<{ workingDays: number }>(
    `/leave-requests/preview?startDate=${startDate}&endDate=${endDate}`,
  );
}
