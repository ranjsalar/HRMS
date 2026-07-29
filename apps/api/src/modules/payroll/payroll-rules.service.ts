import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { PayrollRegion, PayrollRegionRule } from "@prisma/client";
import { TenantContextStorage } from "../../database/prisma/tenant-context.storage";
import type { PayslipRegionRule } from "../../common/payroll/calculate-payslip";
import type { UpsertPayrollRuleDto } from "./dto/payroll-rule.dto";

/**
 * The rate-lookup half of the Project Plan's "rules engine per region"
 * requirement: a company-specific PayrollRegionRule row always wins over
 * the system-wide default (companyId: null) for that region, so an admin
 * changing a rate is a data write, never a redeploy. See DECISIONS.md for
 * why the seeded system defaults are placeholder rates, not production
 * KRG/federal-Iraq law.
 */
@Injectable()
export class PayrollRulesService {
  constructor(private readonly tenantContext: TenantContextStorage) {}

  private tx() {
    const store = this.tenantContext.getStore();
    if (!store) {
      throw new Error("PayrollRulesService used outside a tenant-scoped request");
    }
    return store.tx;
  }

  async getRuleForCompany(companyId: string, region: PayrollRegion): Promise<PayslipRegionRule> {
    const row = (await this.findRow(companyId, region)) ?? (await this.findRow(null, region));
    if (!row) {
      throw new NotFoundException(
        `No PayrollRegionRule configured for region "${region}" (no company override and no system default) — seed one before running payroll.`,
      );
    }

    const taxBrackets = await this.tx().payrollTaxBracket.findMany({
      where: { ruleId: row.id },
      orderBy: { order: "asc" },
    });

    return {
      overtimeMultiplier: row.overtimeMultiplier,
      standardMonthlyHours: row.standardMonthlyHours,
      standardWorkingDaysPerMonth: row.standardWorkingDaysPerMonth,
      socialSecurityEmployeePct: row.socialSecurityEmployeePct,
      taxBrackets: taxBrackets.map((b) => ({
        upToAmount: b.upToAmount,
        ratePercent: b.ratePercent,
      })),
    };
  }

  listCompanyRules(companyId: string): Promise<PayrollRegionRule[]> {
    return this.tx().payrollRegionRule.findMany({
      where: { companyId },
      orderBy: { region: "asc" },
    });
  }

  /**
   * The raw row (not the calc-shaped PayslipRegionRule), specifically so
   * callers can inspect `verified` — PayrollRunsService.finalize's
   * unverified-rate guard is the only current caller. Same
   * company-override-then-system-default fallback as getRuleForCompany.
   */
  async getRuleRowForCompany(companyId: string, region: PayrollRegion): Promise<PayrollRegionRule> {
    const row = (await this.findRow(companyId, region)) ?? (await this.findRow(null, region));
    if (!row) {
      throw new NotFoundException(
        `No PayrollRegionRule configured for region "${region}" (no company override and no system default) — seed one before running payroll.`,
      );
    }
    return row;
  }

  /** Creates or replaces this company's override for `dto.region` — the system default for that region is untouched either way. */
  async upsertCompanyRule(
    companyId: string,
    dto: UpsertPayrollRuleDto,
  ): Promise<PayrollRegionRule> {
    this.validateBrackets(dto.taxBrackets);
    const verified = dto.verified ?? false;

    const existing = await this.findRow(companyId, dto.region);
    const data = {
      overtimeMultiplier: dto.overtimeMultiplier,
      standardMonthlyHours: dto.standardMonthlyHours,
      standardWorkingDaysPerMonth: dto.standardWorkingDaysPerMonth,
      socialSecurityEmployeePct: dto.socialSecurityEmployeePct,
      verified,
    };

    const rule = existing
      ? await this.tx().payrollRegionRule.update({ where: { id: existing.id }, data })
      : await this.tx().payrollRegionRule.create({
          data: { companyId, region: dto.region, ...data },
        });

    // Replace the bracket set wholesale — brackets have no identity
    // outside "this rule's Nth band," so diffing individual rows against
    // `order` buys nothing over delete-and-recreate.
    await this.tx().payrollTaxBracket.deleteMany({ where: { ruleId: rule.id } });
    if (dto.taxBrackets.length > 0) {
      await this.tx().payrollTaxBracket.createMany({
        data: dto.taxBrackets.map((bracket, index) => ({
          companyId,
          ruleId: rule.id,
          order: index,
          upToAmount: bracket.upToAmount ?? null,
          ratePercent: bracket.ratePercent,
          verified,
        })),
      });
    }

    return rule;
  }

  private findRow(
    companyId: string | null,
    region: PayrollRegion,
  ): Promise<PayrollRegionRule | null> {
    return this.tx().payrollRegionRule.findFirst({ where: { companyId, region } });
  }

  private validateBrackets(brackets: UpsertPayrollRuleDto["taxBrackets"]): void {
    let previousUpTo = 0;
    brackets.forEach((bracket, index) => {
      const isLast = index === brackets.length - 1;
      if (bracket.upToAmount === undefined) {
        if (!isLast) {
          throw new BadRequestException(
            "Only the last (unbounded) tax bracket may omit upToAmount",
          );
        }
        return;
      }
      if (bracket.upToAmount <= previousUpTo) {
        throw new BadRequestException("Tax bracket upToAmount values must be strictly ascending");
      }
      previousUpTo = bracket.upToAmount;
    });
  }
}
