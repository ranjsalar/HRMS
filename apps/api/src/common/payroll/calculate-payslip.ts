import { Prisma } from "@prisma/client";
import { countWorkingDays } from "../leave/working-days";
import {
  type AttendancePunch,
  computeOvertimeHours,
  computeTotalWorkedHours,
} from "./attendance-hours";
import { roundCurrency, type Currency, type Money } from "./money";
import { computeProgressiveTax, type TaxBracket } from "./tax";

export interface PayslipRegionRule {
  overtimeMultiplier: Money;
  standardMonthlyHours: number;
  standardWorkingDaysPerMonth: number;
  socialSecurityEmployeePct: Money;
  /** Sorted ascending by bracket order — see tax.ts. */
  taxBrackets: readonly TaxBracket[];
}

/** One approved, unpaid-LeaveType leave request's date range, already clamped to the payroll period being calculated. */
export interface UnpaidLeavePeriod {
  startDate: Date;
  endDate: Date;
}

export interface CalculatePayslipInput {
  salaryBase: Money;
  currency: Currency;
  rule: PayslipRegionRule;
  /** Already filtered to this employee + this payroll period. */
  attendanceRecords: readonly AttendancePunch[];
  unpaidLeavePeriods: readonly UnpaidLeavePeriod[];
  weekendDays: readonly number[];
  holidayDateKeys: ReadonlySet<string>;
}

export interface PayslipBreakdown {
  baseSalary: string;
  hourlyRate: string;
  overtimeHours: number;
  overtimeMultiplier: string;
  overtimePay: string;
  dailyRate: string;
  unpaidLeaveDays: number;
  unpaidLeaveDeduction: string;
  socialSecurityPct: string;
  socialSecurityDeduction: string;
  taxDeduction: string;
}

export interface PayslipCalcResult {
  gross: Money;
  deductions: Money;
  net: Money;
  breakdown: PayslipBreakdown;
}

const ZERO = new Prisma.Decimal(0);

/**
 * The full per-employee payslip pipeline, pure and DB-free so it's
 * directly unit-testable. Every intermediate figure (rates, overtime pay,
 * unpaid-leave deduction, social security, tax) stays at full Decimal
 * precision — `roundCurrency` is called exactly twice, right here, to
 * produce `gross` and `deductions`; `net` is derived by subtracting those
 * two ALREADY-ROUNDED values (exact, no further rounding needed) rather
 * than rounding a separately-computed net figure. See DECISIONS.md and
 * this pipeline's boundary test for why that order matters.
 *
 * Pipeline, in order: hourly/daily rate -> overtime pay -> unpaid-leave
 * deduction -> gross (salary - unpaid-leave + overtime) -> social security
 * (percent of gross) -> taxable amount (gross - social security) ->
 * progressive tax -> deductions (social security + tax) -> round both ->
 * net (rounded gross - rounded deductions).
 */
export function calculatePayslip(input: CalculatePayslipInput): PayslipCalcResult {
  const { salaryBase, currency, rule } = input;

  const hourlyRate =
    rule.standardMonthlyHours > 0 ? salaryBase.dividedBy(rule.standardMonthlyHours) : ZERO;
  const dailyRate =
    rule.standardWorkingDaysPerMonth > 0
      ? salaryBase.dividedBy(rule.standardWorkingDaysPerMonth)
      : ZERO;

  const totalWorkedHours = computeTotalWorkedHours(input.attendanceRecords);
  const overtimeHours = computeOvertimeHours(totalWorkedHours, rule.standardMonthlyHours);
  const overtimePay = hourlyRate.times(rule.overtimeMultiplier).times(overtimeHours);

  const unpaidLeaveDays = input.unpaidLeavePeriods.reduce(
    (total, period) =>
      total +
      countWorkingDays(period.startDate, period.endDate, input.weekendDays, input.holidayDateKeys),
    0,
  );
  const unpaidLeaveDeduction = dailyRate.times(unpaidLeaveDays);

  const grossFull = salaryBase.minus(unpaidLeaveDeduction).plus(overtimePay);

  const socialSecurityDeduction = grossFull.times(rule.socialSecurityEmployeePct).dividedBy(100);
  const taxableAmount = grossFull.minus(socialSecurityDeduction);
  const taxDeduction = computeProgressiveTax(taxableAmount, rule.taxBrackets);

  const deductionsFull = socialSecurityDeduction.plus(taxDeduction);

  const gross = roundCurrency(grossFull, currency);
  const deductions = roundCurrency(deductionsFull, currency);
  const net = gross.minus(deductions);

  return {
    gross,
    deductions,
    net,
    breakdown: {
      baseSalary: salaryBase.toString(),
      hourlyRate: hourlyRate.toString(),
      overtimeHours,
      overtimeMultiplier: rule.overtimeMultiplier.toString(),
      overtimePay: overtimePay.toString(),
      dailyRate: dailyRate.toString(),
      unpaidLeaveDays,
      unpaidLeaveDeduction: unpaidLeaveDeduction.toString(),
      socialSecurityPct: rule.socialSecurityEmployeePct.toString(),
      socialSecurityDeduction: socialSecurityDeduction.toString(),
      taxDeduction: taxDeduction.toString(),
    },
  };
}
