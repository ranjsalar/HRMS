import { computeOvertimeHours, computeTotalWorkedHours } from "./attendance-hours";

const at = (iso: string) => new Date(iso);

describe("computeTotalWorkedHours", () => {
  it("sums hours across multiple completed punches", () => {
    const hours = computeTotalWorkedHours([
      { clockIn: at("2026-02-02T08:00:00Z"), clockOut: at("2026-02-02T16:00:00Z") }, // 8h
      { clockIn: at("2026-02-03T08:00:00Z"), clockOut: at("2026-02-03T17:30:00Z") }, // 9.5h
    ]);
    expect(hours).toBe(17.5);
  });

  it("a record with no clockOut yet (still open) contributes 0, not an assumed full shift", () => {
    const hours = computeTotalWorkedHours([
      { clockIn: at("2026-02-02T08:00:00Z"), clockOut: at("2026-02-02T16:00:00Z") }, // 8h
      { clockIn: at("2026-02-03T08:00:00Z"), clockOut: null }, // still clocked in
    ]);
    expect(hours).toBe(8);
  });

  it("no records at all is 0 hours", () => {
    expect(computeTotalWorkedHours([])).toBe(0);
  });
});

describe("computeOvertimeHours", () => {
  it("hours beyond the standard are overtime", () => {
    expect(computeOvertimeHours(250, 240)).toBe(10);
  });

  it("exactly meeting the standard is zero overtime", () => {
    expect(computeOvertimeHours(240, 240)).toBe(0);
  });

  it("falling short of the standard is zero overtime, never negative", () => {
    expect(computeOvertimeHours(200, 240)).toBe(0);
  });
});
