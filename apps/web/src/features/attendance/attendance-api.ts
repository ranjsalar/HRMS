import { apiFetch } from "@/lib/api-client";

export interface AttendanceRecordDto {
  id: string;
  employeeId: string;
  clockIn: string;
  clockOut: string | null;
  withinGeofence: boolean | null;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * UTC calendar date, deliberately — matches the backend's own "day"
 * convention used throughout this project (HolidaysService's `todayUtc`,
 * working-days.ts's UTC normalization), not the browser's local
 * timezone. `TimesheetRangeDto` parses `from`/`to` as UTC-midnight-anchored
 * dates, so this stays consistent with that rather than introducing a
 * second, browser-local notion of "today."
 */
function todayUtcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The backend has no dedicated "today's status" endpoint — `GET
 * /attendance/me` already returns this employee's records for a date
 * range, ordered newest-first, so requesting today's range and taking the
 * first entry is enough. Adding a separate backend endpoint just to save
 * one field of client-side reasoning wasn't worth it (unlike the
 * leave-day-preview endpoint from 9.1, which wrapped real calculation
 * logic, not a single array-index lookup).
 */
export async function fetchTodayAttendance(): Promise<AttendanceRecordDto | null> {
  const today = todayUtcDateString();
  const records = await apiFetch<AttendanceRecordDto[]>(
    `/attendance/me?from=${today}&to=${today}`,
  );
  return records[0] ?? null;
}

export function clockIn(coords?: Coordinates): Promise<AttendanceRecordDto> {
  return apiFetch<AttendanceRecordDto>("/attendance/clock-in", {
    method: "POST",
    body: coords ?? {},
  });
}

export function clockOut(coords?: Coordinates): Promise<AttendanceRecordDto> {
  return apiFetch<AttendanceRecordDto>("/attendance/clock-out", {
    method: "POST",
    body: coords ?? {},
  });
}
