import { Prisma } from "@prisma/client";
import {
  calculatePayslip,
  type CalculatePayslipInput,
  type PayslipRegionRule,
} from "./calculate-payslip";
import type { TaxBracket } from "./tax";

const D = (v: number | string) => new Prisma.Decimal(v);
const at = (iso: string) => new Date(iso);

// Placeholder rates — not real KRG/federal Iraq law, see DECISIONS.md.
// Deliberately different between the two regions (rate AND bracket
// structure) so the "region actually changes the result" test has
// something real to observe.
const KRG_BRACKETS: TaxBracket[] = [
  { upToAmount: D(500000), ratePercent: D(3) },
  { upToAmount: null, ratePercent: D(5) },
];
const FEDERAL_BRACKETS: TaxBracket[] = [
  { upToAmount: D(250000), ratePercent: D(3) },
  { upToAmount: D(750000), ratePercent: D(5) },
  { upToAmount: null, ratePercent: D(10) },
];

function krgRule(overrides: Partial<PayslipRegionRule> = {}): PayslipRegionRule {
  return {
    overtimeMultiplier: D(1.5),
    standardMonthlyHours: 240,
    standardWorkingDaysPerMonth: 26,
    socialSecurityEmployeePct: D(5),
    taxBrackets: KRG_BRACKETS,
    ...overrides,
  };
}

function baseInput(overrides: Partial<CalculatePayslipInput> = {}): CalculatePayslipInput {
  return {
    salaryBase: D(3000000),
    currency: "IQD",
    rule: krgRule(),
    attendanceRecords: [],
    unpaidLeavePeriods: [],
    weekendDays: [5, 6],
    holidayDateKeys: new Set(),
    ...overrides,
  };
}

describe("calculatePayslip — overtime", () => {
  it("an employee with 10 hours of overtime gets overtime pay added to gross, and higher net than someone with none", () => {
    const withOvertime = calculatePayslip(
      baseInput({
        attendanceRecords: [
          { clockIn: at("2026-02-01T00:00:00Z"), clockOut: at("2026-02-11T10:00:00Z") },
        ], // 250h
      }),
    );
    // hourlyRate = 3,000,000/240 = 12,500; overtimePay = 12,500*1.5*10 = 187,500
    expect(withOvertime.breakdown.overtimeHours).toBe(10);
    expect(withOvertime.breakdown.overtimePay).toBe("187500");
    expect(withOvertime.gross.toFixed(0)).toBe("3187500");
    expect(withOvertime.deductions.toFixed(0)).toBe("300781");
    expect(withOvertime.net.toFixed(0)).toBe("2886719");

    const noOvertime = calculatePayslip(
      baseInput({
        attendanceRecords: [
          { clockIn: at("2026-02-01T00:00:00Z"), clockOut: at("2026-02-11T00:00:00Z") },
        ], // 240h
      }),
    );
    expect(noOvertime.breakdown.overtimeHours).toBe(0);
    expect(noOvertime.gross.toFixed(0)).toBe("3000000");
    expect(noOvertime.deductions.toFixed(0)).toBe("282500");
    expect(noOvertime.net.toFixed(0)).toBe("2717500");

    expect(withOvertime.net.greaterThan(noOvertime.net)).toBe(true);
  });
});

describe("calculatePayslip — currency: USD vs IQD in the same run, no cross-contamination", () => {
  it("computing a USD payslip and an IQD payslip with the SAME shared rule object produces independently-correct, currency-appropriate rounding for each, regardless of call order", () => {
    const sharedRule = krgRule(); // one object reference, reused across both calls
    const usdInput = baseInput({ salaryBase: D("1000.555"), currency: "USD", rule: sharedRule });
    const iqdInput = baseInput({ salaryBase: D(3000000), currency: "IQD", rule: sharedRule });

    const usdFirst = calculatePayslip(usdInput);
    const iqdAfterUsd = calculatePayslip(iqdInput);
    const iqdFirst = calculatePayslip(iqdInput);
    const usdAfterIqd = calculatePayslip(usdInput);

    // USD: 2 decimal places, and the fractional salary actually produced
    // a non-whole cents value — proves real 2dp rounding happened, not an
    // accidental integer.
    expect(usdFirst.gross.toFixed(2)).toBe("1000.56");
    expect(usdFirst.deductions.toFixed(2)).toBe("78.54");
    expect(usdFirst.net.toFixed(2)).toBe("922.02");

    // IQD: whole dinars, no decimal component at all.
    expect(iqdAfterUsd.gross.toFixed(0)).toBe("3000000");
    expect(iqdAfterUsd.deductions.toFixed(0)).toBe("282500");

    // Order-independent: same shared rule, interleaved calls, identical
    // results either way — nothing about computing the USD payslip
    // leaked into or mutated the IQD result or the shared rule object.
    expect(iqdFirst.gross.equals(iqdAfterUsd.gross)).toBe(true);
    expect(iqdFirst.deductions.equals(iqdAfterUsd.deductions)).toBe(true);
    expect(usdAfterIqd.gross.equals(usdFirst.gross)).toBe(true);
    expect(usdAfterIqd.deductions.equals(usdFirst.deductions)).toBe(true);
  });
});

describe("calculatePayslip — rounding boundary: net is derived from ALREADY-ROUNDED gross/deductions, never independently rounded", () => {
  it("a case engineered so the two approaches diverge produces the documented (round-then-subtract) result", () => {
    // salaryBase=100.008, socialSecurityEmployeePct=50%, 0% tax, no
    // overtime/leave -> grossFull=100.008 exactly, deductionsFull=50.004
    // exactly (100.008 * 50%).
    //   Rule implemented here: round(100.008)=100.01, round(50.004)=50.00
    //   -> net = 100.01 - 50.00 = 50.01.
    //   Alternative (NOT implemented): net_full = 100.008-50.004=50.004
    //   -> round(50.004) = 50.00. A DIFFERENT answer.
    const result = calculatePayslip({
      salaryBase: D("100.008"),
      currency: "USD",
      rule: {
        overtimeMultiplier: D(0),
        standardMonthlyHours: 1,
        standardWorkingDaysPerMonth: 1,
        socialSecurityEmployeePct: D(50),
        taxBrackets: [{ upToAmount: null, ratePercent: D(0) }],
      },
      attendanceRecords: [],
      unpaidLeavePeriods: [],
      weekendDays: [5, 6],
      holidayDateKeys: new Set(),
    });

    expect(result.gross.toFixed(2)).toBe("100.01");
    expect(result.deductions.toFixed(2)).toBe("50.00");
    // The documented rule's answer — NOT "50.00", which is what
    // rounding net independently from full-precision figures would give.
    expect(result.net.toFixed(2)).toBe("50.01");
  });
});

describe("calculatePayslip — unpaid leave", () => {
  it("unpaid leave days within the period proportionally reduce gross pay", () => {
    const paid = calculatePayslip(baseInput());
    const withUnpaidLeave = calculatePayslip(
      baseInput({
        // Mon Feb 2 - Wed Feb 4, 2026: 3 working days, no weekend inside.
        unpaidLeavePeriods: [{ startDate: at("2026-02-02"), endDate: at("2026-02-04") }],
      }),
    );

    expect(withUnpaidLeave.breakdown.unpaidLeaveDays).toBe(3);
    // dailyRate = 3,000,000/26 = 115,384.615...; 3 days = 346,153.85 (full
    // precision, not rounded until gross is).
    expect(withUnpaidLeave.gross.toFixed(0)).toBe("2653846"); // 3,000,000 - 346,153.85 (rounded)
    expect(withUnpaidLeave.gross.lessThan(paid.gross)).toBe(true);
    expect(withUnpaidLeave.net.lessThan(paid.net)).toBe(true);
  });

  it("a leave type with no unpaid days configured is a documented no-op — zero periods changes nothing", () => {
    const result = calculatePayslip(baseInput({ unpaidLeavePeriods: [] }));
    expect(result.breakdown.unpaidLeaveDays).toBe(0);
    expect(result.breakdown.unpaidLeaveDeduction).toBe("0");
  });
});

describe("calculatePayslip — region rules produce different net pay on identical salaries", () => {
  it("KRG vs federal Iraq rules (different social security % and tax brackets) on the SAME salary produce DIFFERENT net pay", () => {
    const krg = calculatePayslip(baseInput({ rule: krgRule() }));
    const federal = calculatePayslip(
      baseInput({
        rule: krgRule({ socialSecurityEmployeePct: D(7), taxBrackets: FEDERAL_BRACKETS }),
      }),
    );

    expect(krg.net.toFixed(0)).toBe("2717500");
    expect(federal.net.toFixed(0)).toBe("2553500");
    expect(krg.net.equals(federal.net)).toBe(false);
  });
});
