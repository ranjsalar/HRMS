import { Body, Controller, Get, NotFoundException, Post } from "@nestjs/common";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { UpsertPayrollRuleDto } from "./dto/payroll-rule.dto";
import { PayrollRulesService } from "./payroll-rules.service";

// Gated on "edit", not "view" — deliberately. Employees also hold a
// payroll:view grant (self-scoped, for their own payslips — see
// PayslipsController), and reusing "view" here would let that same grant
// satisfy a company-wide rules-configuration endpoint it was never meant
// to reach. "edit" has no such self-scoped grant in the default matrix,
// so both listing and writing rules end up admin-only by construction,
// without needing a whole separate RBAC module (contrast with why
// LeaveType CRUD got its own "leave_types" module in step 7 — there,
// "create" itself collided; here, picking a different existing action
// avoids the collision without adding a module).
@Controller("payroll/rules")
export class PayrollRulesController {
  constructor(private readonly payrollRulesService: PayrollRulesService) {}

  @RequirePermission("payroll", "edit")
  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.payrollRulesService.listCompanyRules(user.companyId);
  }

  @RequirePermission("payroll", "edit")
  @Post()
  upsert(@CurrentUser() user: AccessTokenPayload, @Body() dto: UpsertPayrollRuleDto) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.payrollRulesService.upsertCompanyRule(user.companyId, dto);
  }
}
