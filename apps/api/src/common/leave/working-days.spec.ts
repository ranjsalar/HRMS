import { countWorkingDays, isWeekendDay, prorateAnnualDays, toDateKey } from "./working-days";

// Kurdistan-convention weekend: Friday(5) + Saturday(6), NOT Sat/Sun or
// Mon-Fri. Every fixture date's real-world weekday is stated in a comment
// and was independently confirmed against a calendar before being used
// here — the point of these tests is to catch an off-by-one in the
// counting logic, not to re-derive what day of the week a date falls on.
const WEEKEND = [5, 6];
const date = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe("countWorkingDays", () => {
  it("counts a full week, excluding only the configured weekend (Fri+Sat, not Sun)", () => {
    // Mon Jun 1 - Sun Jun 7, 2026: Mon,Tue,Wed,Thu,Fri,Sat,Sun.
    // Fri(5)/Sat(6) excluded -> Mon,Tue,Wed,Thu,Sun = 5.
    const count = countWorkingDays(date("2026-06-01"), date("2026-06-07"), WEEKEND, new Set());
    expect(count).toBe(5);
  });

  it("excludes a holiday that falls on an otherwise-working day", () => {
    // Mon Jun 1 - Fri Jun 5, 2026: Mon,Tue,Wed,Thu,Fri. Fri excluded as
    // weekend already; Wed Jun 3 excluded as a holiday on top of that.
    // Working: Mon, Tue, Thu = 3.
    const holidays = new Set([toDateKey(date("2026-06-03"))]);
    const count = countWorkingDays(date("2026-06-01"), date("2026-06-05"), WEEKEND, holidays);
    expect(count).toBe(3);
  });

  it("a holiday landing on what's already a weekend doesn't double-subtract", () => {
    const holidays = new Set([toDateKey(date("2026-06-05"))]); // Friday, already weekend
    const withHoliday = countWorkingDays(date("2026-06-01"), date("2026-06-07"), WEEKEND, holidays);
    const without = countWorkingDays(date("2026-06-01"), date("2026-06-07"), WEEKEND, new Set());
    expect(withHoliday).toBe(without); // still 5 either way
  });

  it("a request spanning the configured weekend excludes exactly those days", () => {
    // Thu Jun 4 - Mon Jun 8, 2026: Thu,Fri,Sat,Sun,Mon.
    // Fri/Sat excluded -> Thu, Sun, Mon = 3.
    const count = countWorkingDays(date("2026-06-04"), date("2026-06-08"), WEEKEND, new Set());
    expect(count).toBe(3);
  });

  it("a request spanning a year boundary (Dec into Jan) counts continuously across it", () => {
    // Mon Dec 28, 2026 - Sun Jan 3, 2027: Dec28(Mon),29(Tue),30(Wed),
    // 31(Thu), Jan1(Fri 2027), Jan2(Sat), Jan3(Sun).
    // Fri Jan1 / Sat Jan2 excluded -> Dec28,29,30,31, Jan3 = 5.
    const count = countWorkingDays(date("2026-12-28"), date("2027-01-03"), WEEKEND, new Set());
    expect(count).toBe(5);
  });

  it("a single working day counts as 1, a single weekend day counts as 0", () => {
    expect(countWorkingDays(date("2026-06-01"), date("2026-06-01"), WEEKEND, new Set())).toBe(1);
    expect(countWorkingDays(date("2026-06-05"), date("2026-06-05"), WEEKEND, new Set())).toBe(0);
  });

  it("throws if end is before start", () => {
    expect(() =>
      countWorkingDays(date("2026-06-05"), date("2026-06-01"), WEEKEND, new Set()),
    ).toThrow();
  });
});

describe("isWeekendDay", () => {
  it("Friday and Saturday are weekend under the Kurdistan-convention default", () => {
    expect(isWeekendDay(date("2026-06-05"), WEEKEND)).toBe(true); // Fri
    expect(isWeekendDay(date("2026-06-06"), WEEKEND)).toBe(true); // Sat
  });

  it("Sunday is NOT weekend under this config, unlike a Western Mon-Fri assumption", () => {
    expect(isWeekendDay(date("2026-06-07"), WEEKEND)).toBe(false); // Sun
  });
});

describe("prorateAnnualDays", () => {
  it("hired in an earlier year -> full entitlement for the target year", () => {
    expect(prorateAnnualDays(20, date("2020-03-01"), 2026)).toBe(20);
  });

  it("hired Jan 1 of the target year -> full entitlement (no proration)", () => {
    expect(prorateAnnualDays(20, date("2026-01-01"), 2026)).toBe(20);
  });

  it("not yet hired in the target year -> 0", () => {
    expect(prorateAnnualDays(20, date("2027-02-01"), 2026)).toBe(0);
  });

  it("hired mid-year: 183 of 365 remaining days -> proportional entitlement", () => {
    // daysPerYear=20, hired 2026-07-02, 183 days remain (inclusive)
    // through Dec 31 of a 365-day year: 20 * 183/365 = 10.027... -> 10.03.
    expect(prorateAnnualDays(20, date("2026-07-02"), 2026)).toBe(10.03);
  });

  it("hired Dec 31 -> a small fraction of a day, not zero", () => {
    expect(prorateAnnualDays(20, date("2026-12-31"), 2026)).toBe(0.05);
  });
});
