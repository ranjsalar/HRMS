import type { PrismaClient } from "@prisma/client";

export interface TaxBracketSeed {
  upToAmount: number | null; // null = unbounded top bracket
  ratePercent: number;
}

export interface PayrollRegionRuleSeed {
  region: "krg" | "federal_iraq";
  overtimeMultiplier: number;
  standardMonthlyHours: number;
  standardWorkingDaysPerMonth: number;
  socialSecurityEmployeePct: number;
  taxBrackets: TaxBracketSeed[];
}

/**
 * System-wide (companyId: null) default payroll rules — one per region,
 * used whenever a company hasn't created its own override via
 * `POST /payroll/rules`.
 *
 * ⚠ PLACEHOLDER RATES, NOT LEGAL ADVICE. These figures (overtime
 * multiplier, social security %, tax brackets) are illustrative, chosen
 * so the two regions' rules genuinely differ from each other and produce
 * plausible-looking payslips — they have NOT been reviewed against real
 * KRG or federal Iraqi labor/tax law. This must be reviewed and corrected
 * by someone with real regional payroll/legal expertise before any real
 * company's payroll is run through it. Same caveat class as the seed i18n
 * translations (step 1) and the seed holiday calendar (step 6/7) — a
 * starting point proving the mechanism works, not a source of truth.
 */
export const SYSTEM_PAYROLL_RULES: PayrollRegionRuleSeed[] = [
  {
    region: "krg",
    overtimeMultiplier: 1.5,
    standardMonthlyHours: 240, // 8h x ~30 days
    standardWorkingDaysPerMonth: 26,
    socialSecurityEmployeePct: 5,
    taxBrackets: [
      { upToAmount: 500000, ratePercent: 3 },
      { upToAmount: null, ratePercent: 5 },
    ],
  },
  {
    region: "federal_iraq",
    overtimeMultiplier: 1.5,
    standardMonthlyHours: 240,
    standardWorkingDaysPerMonth: 26,
    socialSecurityEmployeePct: 7,
    taxBrackets: [
      { upToAmount: 250000, ratePercent: 3 },
      { upToAmount: 750000, ratePercent: 5 },
      { upToAmount: null, ratePercent: 10 },
    ],
  },
];

/** Replaces the system-wide (companyId: null) rules with the list above. Company-specific override rows are left untouched. Safe to re-run. */
export async function seedPayrollRules(prisma: PrismaClient): Promise<void> {
  for (const ruleSeed of SYSTEM_PAYROLL_RULES) {
    await prisma.payrollTaxBracket.deleteMany({
      where: { rule: { companyId: null, region: ruleSeed.region } },
    });
    await prisma.payrollRegionRule.deleteMany({
      where: { companyId: null, region: ruleSeed.region },
    });

    const rule = await prisma.payrollRegionRule.create({
      data: {
        companyId: null,
        region: ruleSeed.region,
        overtimeMultiplier: ruleSeed.overtimeMultiplier,
        standardMonthlyHours: ruleSeed.standardMonthlyHours,
        standardWorkingDaysPerMonth: ruleSeed.standardWorkingDaysPerMonth,
        socialSecurityEmployeePct: ruleSeed.socialSecurityEmployeePct,
      },
    });

    await prisma.payrollTaxBracket.createMany({
      data: ruleSeed.taxBrackets.map((bracket, index) => ({
        companyId: null,
        ruleId: rule.id,
        order: index,
        upToAmount: bracket.upToAmount,
        ratePercent: bracket.ratePercent,
      })),
    });
  }
}
