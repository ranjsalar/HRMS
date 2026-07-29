import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { CreatePayrollRunDto, FinalizePayrollRunDto } from "./dto/payroll-run.dto";
import { PayrollRunsService } from "./payroll-runs.service";
import { PayslipsService } from "./payslips.service";

// Every route here is gated on "create"/"edit"/"approve", never "view" —
// same reasoning as PayrollRulesController: an employee's payroll:view
// grant is self-scoped to their OWN payslips (PayslipsController), and
// has nothing to do with company-wide payroll RUN management. None of
// create/edit/approve carry a self-scoped grant in the default matrix, so
// this whole controller is admin-only by construction.
@Controller("payroll/runs")
export class PayrollRunsController {
  constructor(
    private readonly payrollRunsService: PayrollRunsService,
    private readonly payslipsService: PayslipsService,
  ) {}

  @RequirePermission("payroll", "create")
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: CreatePayrollRunDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.payrollRunsService.createDraft(user.companyId, dto, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("payroll", "edit")
  @Post(":id/recompute")
  recompute(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.payrollRunsService.recompute(id, user.companyId, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("payroll", "approve")
  @Post(":id/finalize")
  finalize(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: FinalizePayrollRunDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.payrollRunsService.finalize(
      id,
      user.companyId,
      scope,
      { acknowledgeUnverifiedRates: dto.acknowledgeUnverifiedRates },
      { userId: user.sub, ipAddress },
    );
  }

  @RequirePermission("payroll", "edit")
  @Get()
  list(@CurrentUser() user: AccessTokenPayload) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.payrollRunsService.findMany(user.companyId);
  }

  @RequirePermission("payroll", "edit")
  @Get(":id")
  async findOne(@Param("id") id: string) {
    const run = await this.payrollRunsService.findOne(id);
    if (!run) {
      throw new NotFoundException("Payroll run not found");
    }
    return run;
  }

  // Admin/team review — deliberately NOT restricted to finalized runs
  // (see PayslipsService.listForRun): reviewing a draft's payslips before
  // finalizing is the point of the draft state.
  @RequirePermission("payroll", "edit")
  @Get(":id/payslips")
  payslipsForRun(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Query("employeeId") employeeId?: string,
  ) {
    return this.payslipsService.listForRun(id, user.sub, scope, employeeId);
  }
}
