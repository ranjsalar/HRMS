import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import type { PermissionScope } from "@prisma/client";
import { ClientIp } from "../../common/decorators/client-ip.decorator";
import { CurrentPermissionScope } from "../../common/decorators/current-permission-scope.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequirePermission } from "../../common/decorators/require-permission.decorator";
import type { AccessTokenPayload } from "../auth/token.service";
import { CreateEmployeeDto, UpdateEmployeeDto, UpdateOwnEmployeeDto } from "./dto/employee.dto";
import { EmployeesService } from "./employees.service";

@Controller("employees")
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @RequirePermission("employees", "view")
  @Get()
  list(@CurrentUser() user: AccessTokenPayload, @CurrentPermissionScope() scope: PermissionScope) {
    return this.employeesService.findMany(user.sub, scope);
  }

  // Registered before ":id" so "me" isn't swallowed by the :id route —
  // same pattern as DepartmentController's "org-chart". Self-service
  // profile view: doesn't require the caller to know their own Employee
  // id (which nothing else exposes to them — /auth/me returns userId,
  // not employeeId).
  @RequirePermission("employees", "view")
  @Get("me")
  async findOwn(@CurrentUser() user: AccessTokenPayload) {
    const employee = await this.employeesService.findOwn(user.sub);
    if (!employee) {
      throw new NotFoundException("No employee record is linked to this account");
    }
    return employee;
  }

  // UpdateOwnEmployeeDto structurally cannot carry salaryBase/nationalId/
  // bankAccount/departmentId/branchId/fullName/jobTitle/hireDate/currency
  // — see that DTO's own comment. EmployeesService.updateOwn() also routes
  // through the same scope="self" allow-list enforcement the general
  // PATCH :id route uses, so this guarantee holds even if a future DTO
  // change ever widened this class.
  @RequirePermission("employees", "edit")
  @Patch("me")
  async updateOwn(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: UpdateOwnEmployeeDto,
    @ClientIp() ipAddress: string,
  ) {
    const employee = await this.employeesService.updateOwn(user.sub, dto, {
      userId: user.sub,
      ipAddress,
    });
    if (!employee) {
      throw new NotFoundException("No employee record is linked to this account");
    }
    return employee;
  }

  @RequirePermission("employees", "view")
  @Get(":id")
  async findOne(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
  ) {
    const employee = await this.employeesService.findOne(id, user.sub, scope);
    if (!employee) {
      // Deliberately the same 404 whether the employee doesn't exist or
      // exists outside the caller's permitted scope — distinguishing the
      // two would leak which employees exist in departments the caller
      // can't otherwise see.
      throw new NotFoundException("Employee not found");
    }
    return employee;
  }

  @RequirePermission("employees", "create")
  @Post()
  create(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Body() dto: CreateEmployeeDto,
    @ClientIp() ipAddress: string,
  ) {
    if (!user.companyId) {
      throw new NotFoundException("This endpoint requires a company-scoped session");
    }
    return this.employeesService.create(user.companyId, dto, scope, user.sub, {
      userId: user.sub,
      ipAddress,
    });
  }

  @RequirePermission("employees", "edit")
  @Patch(":id")
  async update(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @Body() dto: UpdateEmployeeDto,
    @ClientIp() ipAddress: string,
  ) {
    const employee = await this.employeesService.update(id, dto, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!employee) {
      throw new NotFoundException("Employee not found");
    }
    return employee;
  }

  // Soft-delete only — status -> terminated. Payroll/attendance/leave
  // history must survive an employee leaving; there is no hard-delete path.
  @RequirePermission("employees", "delete")
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AccessTokenPayload,
    @CurrentPermissionScope() scope: PermissionScope,
    @Param("id") id: string,
    @ClientIp() ipAddress: string,
  ) {
    const removed = await this.employeesService.softDelete(id, user.sub, scope, {
      userId: user.sub,
      ipAddress,
    });
    if (!removed) {
      throw new NotFoundException("Employee not found");
    }
  }
}
