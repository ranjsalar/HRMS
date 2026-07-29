const MS_PER_HOUR = 60 * 60 * 1000;

export interface AttendancePunch {
  clockIn: Date;
  clockOut: Date | null;
}

/**
 * Sums worked hours across clockIn/clockOut pairs. A record with no
 * clockOut yet (still open — the employee hasn't clocked out, or clocked
 * in right as the payroll period closed) contributes 0: an incomplete
 * punch cannot be counted toward paid hours, and there is deliberately no
 * "assume they worked a full shift" fallback here. See DECISIONS.md.
 */
export function computeTotalWorkedHours(records: readonly AttendancePunch[]): number {
  return records.reduce((total, record) => {
    if (!record.clockOut) return total;
    const ms = record.clockOut.getTime() - record.clockIn.getTime();
    return total + Math.max(0, ms) / MS_PER_HOUR;
  }, 0);
}

/** Hours worked beyond the region's configured standard, floored at 0 (never negative). */
export function computeOvertimeHours(
  totalWorkedHours: number,
  standardMonthlyHours: number,
): number {
  return Math.max(0, totalWorkedHours - standardMonthlyHours);
}
