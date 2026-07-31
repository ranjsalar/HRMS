import { Body, Controller, Get, NotFoundException, Param, Post, Query } from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import {
  ApproveLeaveRequestDto,
  LeaveBalanceQueryDto,
  PreviewLeaveRequestDto,
  RejectLeaveRequestDto,
  SubmitLeaveRequestDto,
  TeamLeaveBalanceQueryDto,
  TeamLeaveRequestQueryDto,
} from "./dto/leave-request.dto";
import { LeaveRequestsService } from "./leave-requests.service";

@Controller()
export class LeaveRequestsController {
  constructor(private readonly leaveRequestsService: LeaveRequestsService) {}

  // employeeId is deliberately never a parameter here — derived from the
  // session's own Employee row, same principle as Attendance clock-in.
  @RequirePermission("leave", "create")
  @Post("leave-requests")
  submit(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: SubmitLeaveRequestDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.leaveRequestsService.submit(user.sub, user.companyId, dto, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("leave", "create")
  @Post("leave-requests/:id/cancel")
  cancel(
    @CurrentUser() user: AccessTokenPayload,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    return this.leaveRequestsService.cancel(user.sub, id, { userId: user.sub, ipAddress });
  }

  // RBAC-gated + department-scoped (own_department for manager, all for
  // company_admin), same pattern as Attendance overrides — plus an
  // explicit can't-decide-your-own-request check inside the service that
  // does not rely on scope alone.
  @RequirePermission("leave", "approve")
  @Post("leave-requests/:id/approve")
  approve(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: ApproveLeaveRequestDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.leaveRequestsService.approve(
      user.sub,
      user.companyId,
      scope,
      id,
      { force: dto.force },
      { userId: user.sub, ipAddress },
    );
  }

  @RequirePermission("leave", "approve")
  @Post("leave-requests/:id/reject")
  reject(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: RejectLeaveRequestDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.leaveRequestsService.reject(user.sub, scope, id, dto.reason, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("leave", "view")
  @Get("leave-requests/me")
  myRequests(@CurrentUser() user: AccessTokenPayload) {
    return this.leaveRequestsService.myRequests(user.sub);
  }

  // Gated on "view", not "create" (step 9.6 revision — was "create" when
  // this only served the employee submit form in 9.3, matching submit()'s
  // own gate; a manager reviewing a pending request needs this same
  // preview and has leave:view own_department but NOT leave:create, which
  // managers structurally never get — approving isn't submitting). "view"
  // is the right common denominator: every role that can see a leave
  // request at all (employee self, manager own_department, admin all)
  // already holds it. Pure calculation either way, no balance/request row
  // touched. companyId-scoped, not employee-scoped: the working-days
  // count only depends on the company's weekend config + holiday
  // calendar, never on who's asking, so no @CurrentPermissionScope needed.
  @RequirePermission("leave", "view")
  @Get("leave-requests/preview")
  async preview(@CurrentUser() user: AccessTokenPayload, @Query() query: PreviewLeaveRequestDto) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    const workingDays = await this.leaveRequestsService.previewWorkingDays(
      user.companyId,
      query.startDate,
      query.endDate,
    );
    return { workingDays };
  }

  @RequirePermission("leave", "view")
  @Get("leave-requests")
  teamRequests(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Query() query: TeamLeaveRequestQueryDto,
  ) {
    return this.leaveRequestsService.teamRequests(user.sub, scope, query.employeeId, query.status);
  }

  @RequirePermission("leave", "view")
  @Get("leave-balances/me")
  myBalances(@CurrentUser() user: AccessTokenPayload, @Query() query: LeaveBalanceQueryDto) {
    return this.leaveRequestsService.myBalances(
      user.sub,
      query.year ?? new Date().getUTCFullYear(),
    );
  }

  // Manager/admin-facing counterpart to "me" — an approver reviewing a
  // pending request needs the SAME balance context the employee saw when
  // submitting it. Registered as a distinct path (not "/leave-balances/
  // :employeeId") so it can never be confused with — or accidentally
  // collide with — "/leave-balances/me".
  @RequirePermission("leave", "view")
  @Get("leave-balances")
  teamBalances(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Query() query: TeamLeaveBalanceQueryDto,
  ) {
    return this.leaveRequestsService.teamBalances(
      user.sub,
      scope,
      query.employeeId,
      query.year ?? new Date().getUTCFullYear(),
    );
  }
}
