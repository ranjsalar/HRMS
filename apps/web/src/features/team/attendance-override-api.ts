import { apiFetch } from "@/lib/api-client";

export interface AttendanceOverrideResult {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  source: "web" | "mobile" | "admin_override";
  note: string | null;
}

export interface SubmitOverrideInput {
  employeeId: string;
  attendanceRecordId?: string;
  clockIn: string;
  clockOut?: string;
  note: string;
}

/**
 * `employeeId` here is never client-invented — every call site passes one
 * that came directly from a TeamList row, which only ever lists employees
 * `GET /employees` (department-scoped) actually returned. The server
 * independently re-validates via the same `EmployeesService.isVisible`
 * check every other manager-reach boundary in this app uses, so this is
 * defense in depth, not the real guarantee. See DECISIONS.md.
 */
export function submitAttendanceOverride(
  input: SubmitOverrideInput,
): Promise<AttendanceOverrideResult> {
  return apiFetch<AttendanceOverrideResult>("/attendance/override", {
    method: "POST",
    body: input,
  });
}
