import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
} from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { AttendanceService } from "./attendance.service";
import {
  AdminOverrideAttendanceDto,
  ClockInDto,
  ClockOutDto,
  TeamTimesheetQueryDto,
  TimesheetRangeDto,
} from "./dto/attendance.dto";

@Controller("attendance")
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  // employeeId is deliberately NEVER read from the request body/params —
  // AttendanceService derives it from the authenticated session's own
  // Employee row. There is no code path here through which one employee
  // could clock in as another.
  @RequirePermission("attendance", "create")
  @Post("clock-in")
  clockIn(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ClockInDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.attendanceService.clockIn(user.sub, user.companyId, dto, {
      userId: user.sub,
      ipAddress,
    });
  }

  // Closes an existing open record rather than creating a new one — 200,
  // not the default 201 a bare @Post would return.
  @RequirePermission("attendance", "create")
  @Post("clock-out")
  @HttpCode(HttpStatus.OK)
  clockOut(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ClockOutDto,
    @ClientIp() ipAddress: string,
  ) {
    return this.attendanceService.clockOut(user.sub, dto, { userId: user.sub, ipAddress });
  }

  // RBAC-gated edit + department-scoped (own_department for manager, all
  // for company_admin) exactly like Employee writes — AttendanceService
  // re-validates target-employee visibility via the same EmployeesService
  // check the Employee module itself uses.
  @RequirePermission("attendance", "edit")
  @Post("override")
  override(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Body() dto: AdminOverrideAttendanceDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.attendanceService.adminOverride(user.sub, user.companyId, scope, dto, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("attendance", "view")
  @Get("me")
  myTimesheet(@CurrentUser() user: AccessTokenPayload, @Query() query: TimesheetRangeDto) {
    return this.attendanceService.myTimesheet(user.sub, query.from, query.to);
  }

  @RequirePermission("attendance", "view")
  @Get()
  teamTimesheet(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Query() query: TeamTimesheetQueryDto,
  ) {
    return this.attendanceService.teamTimesheet(
      user.sub,
      scope,
      query.from,
      query.to,
      query.employeeId,
    );
  }
}
