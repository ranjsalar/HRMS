import { apiFetch } from "@/lib/api-client";

export interface LeaveBalanceDto {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  // Prisma's Decimal serializes to a JSON STRING (e.g. "12.50"), not a
  // number — confirmed by reading how the backend itself handles this
  // field (`Number(balance.balance)` throughout leave.e2e-spec.ts). Parsed
  // with Number(...) at the point of use, not here, so this type stays an
  // honest reflection of what actually comes over the wire.
  balance: string;
}

export interface LeaveTypeDto {
  id: string;
  companyId: string;
  name: string;
  daysPerYear: number;
  requiresApproval: boolean;
  paid: boolean;
  active: boolean;
}

export function fetchMyLeaveBalances(year: number = new Date().getUTCFullYear()): Promise<LeaveBalanceDto[]> {
  return apiFetch<LeaveBalanceDto[]>(`/leave-balances/me?year=${year}`);
}

/** Active leave types only — same endpoint the leave-submission form (9.3) will use. */
export function fetchActiveLeaveTypes(): Promise<LeaveTypeDto[]> {
  return apiFetch<LeaveTypeDto[]>("/leave-types");
}
