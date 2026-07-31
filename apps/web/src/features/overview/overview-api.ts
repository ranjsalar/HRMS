import { apiFetch } from "@/lib/api-client";

export interface AttendanceRecordDto {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
}

/**
 * Reuses the existing, already-tested `GET /attendance` (teamTimesheet)
 * endpoint — company_admin's `attendance:view` scope is "all", so this
 * returns every attendance record company-wide for today, no new backend
 * logic needed. `from`/`to` both set to today's calendar date (UTC —
 * same boundary convention `endOfDayInclusive` already uses server-side
 * for every other date-range query in this app, not something new here).
 */
export function fetchTodayAttendance(): Promise<AttendanceRecordDto[]> {
  const today = new Date().toISOString().slice(0, 10);
  return apiFetch<AttendanceRecordDto[]>(`/attendance?from=${today}&to=${today}`);
}
